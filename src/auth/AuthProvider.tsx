import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { absoluteAppUrl } from "@/lib/config";
import type { AppRole, ProfileRow } from "@/types/database";
import type { RegisterValues } from "@/lib/validation";
import { AuthContext, type AuthContextValue, type AuthStatus } from "./authContext";

/**
 * The single owner of authentication state.
 *
 * Components never call supabase.auth directly — they go through useAuth() —
 * so session restoration, role loading and cache clearing all happen in one
 * place with one set of rules.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<AuthStatus>(
    isSupabaseConfigured ? "loading" : "unconfigured",
  );
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  /*
   * Starts true when the portal is configured, because at that point we do not
   * yet know whether anyone is signed in, let alone who.
   *
   * Effects run after paint, so a first render that reported "signed in, no
   * roles, not loading" would let RequireRole paint "You don't have access"
   * for a frame before the profile effect had run even once. Beginning in the
   * loading state means the guard waits rather than guesses; the effect below
   * clears it as soon as it knows there is no user.
   */
  const [profileLoading, setProfileLoading] = useState(isSupabaseConfigured);

  // Which member the currently-loaded profile/roles belong to. Guards against a
  // slow response for a previous user landing after a different one signs in.
  const loadedForUserId = useRef<string | null>(null);

  /**
   * Loads the profile and roles for a member, retrying a missing row.
   *
   * A signed-in member always has a profile: handle_new_user() creates it
   * inside the signup transaction, and the account is rolled back if that
   * fails. So "no row" here does not mean "no profile" — it means the read
   * did not see one, which in practice is a read that raced the session
   * being attached, or a transient network failure.
   *
   * That distinction matters because the empty result is silent. maybeSingle()
   * returns { data: null, error: null }, so the old code took it as fact: the
   * dashboard greeted the member with no name and RequireRole, seeing an empty
   * roles array and profileLoading already false, rendered "You don't have
   * access to this area" to an actual admin. Nothing retried, so it stayed
   * that way until the page was reloaded.
   */
  const loadProfile = useCallback(async (userId: string) => {
    const supabase = getSupabase();
    setProfileLoading(true);

    const attempts = [0, 150, 400, 1000];
    let lastError: unknown = null;

    for (let i = 0; i < attempts.length; i += 1) {
      if (attempts[i] > 0) {
        await new Promise((resolve) => setTimeout(resolve, attempts[i]));
      }
      // A newer member signed in while this was in flight; that load owns the
      // state now and this one must not write to it.
      if (loadedForUserId.current !== userId) return;

      try {
        const [profileResult, rolesResult] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
          supabase.from("member_roles").select("role").eq("member_id", userId),
        ]);

        if (loadedForUserId.current !== userId) return;
        if (profileResult.error) throw profileResult.error;
        if (rolesResult.error) throw rolesResult.error;

        const row = (profileResult.data as ProfileRow | null) ?? null;
        if (row) {
          setProfile(row);
          setRoles(((rolesResult.data ?? []) as { role: AppRole }[]).map((r) => r.role));
          setProfileLoading(false);
          return;
        }
        lastError = new Error("Profile row not visible yet");
      } catch (error) {
        lastError = error;
      }
    }

    if (loadedForUserId.current !== userId) return;
    // Logged in production too: this is the state where a member is signed in
    // but the app cannot tell who they are, and it is not otherwise visible.
    console.error("[shpe] could not load profile after retries", lastError);
    setProfile(null);
    setRoles([]);
    setProfileLoading(false);
  }, []);

  /*
   * Session tracking only. Nothing in here calls Supabase.
   *
   * onAuthStateChange runs its callback while supabase-js holds an internal
   * lock on the auth state, and the client documents that calling another
   * Supabase method from inside it can deadlock. Profile loading used to run
   * here, so a sign-in could hang on the very query the dashboard needs, and
   * the hang was intermittent because it depended on whether the lock was
   * contended. Reloading the page took the getSession() path instead, which is
   * outside the callback — which is exactly why refreshing "fixed" it.
   *
   * The profile load now lives in its own effect below, keyed on the user id.
   */
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    let active = true;

    const apply = (next: Session | null) => {
      if (!active) return;
      setSession(next);
      setUser(next?.user ?? null);
      setStatus(next ? "signed-in" : "signed-out");
    };

    supabase.auth
      .getSession()
      .then(({ data }) => apply(data.session))
      .catch(() => active && setStatus("signed-out"));

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      apply(next);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  /*
   * Profile and roles, reacting to whoever is signed in.
   *
   * profileLoading is set here rather than inside loadProfile so that it is
   * true in the same render that reports a new user id. RequireRole waits on
   * that flag; if it flipped a tick later, an officer could be shown
   * "You don't have access" for a frame before the roles arrived.
   */
  const userId = user?.id ?? null;
  useEffect(() => {
    if (userId === loadedForUserId.current) return;
    loadedForUserId.current = userId;
    setProfile(null);
    setRoles([]);

    if (!userId) {
      setProfileLoading(false);
      // A different member must never see the previous one's cached data.
      queryClient.clear();
      return;
    }

    setProfileLoading(true);
    void loadProfile(userId);
  }, [userId, loadProfile, queryClient]);

  const refreshProfile = useCallback(async () => {
    const id = user?.id;
    if (id) await loadProfile(id);
  }, [loadProfile, user?.id]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (values: RegisterValues) => {
    // Everything except the credentials rides along as user metadata, which the
    // handle_new_user() trigger reads to build the profile row. `role` is
    // deliberately absent: registration can never assign one.
    const { data, error } = await getSupabase().auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        emailRedirectTo: absoluteAppUrl("/login"),
        data: {
          first_name: values.first_name,
          last_name: values.last_name,
          major: values.major,
          secondary_major: values.secondary_major ?? "",
          graduation_year: String(values.graduation_year),
          degree_level: values.degree_level,
          shpe_national_member: values.shpe_national_member ? "true" : "false",
          shpe_national_member_id: values.shpe_national_member_id ?? "",
          linkedin_url: values.linkedin_url ?? "",
        },
      },
    });
    if (error) throw error;
    return { needsEmailConfirmation: data.session === null };
  }, []);

  const signOut = useCallback(async () => {
    try {
      const { error } = await getSupabase().auth.signOut();
      if (error) throw error;
    } finally {
      // Clear regardless: if sign-out failed we still must not leave member data
      // sitting in the cache on a shared laptop.
      loadedForUserId.current = null;
      setProfile(null);
      setRoles([]);
      queryClient.clear();
    }
  }, [queryClient]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: absoluteAppUrl("/reset-password"),
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const hasRole = (role: AppRole) => roles.includes(role);
    return {
      status,
      session,
      user,
      profile,
      profileLoading,
      roles,
      // Officer permissions are a subset of admin permissions, matching
      // public.is_officer() in the database.
      isOfficer: roles.includes("officer") || roles.includes("admin"),
      isAdmin: roles.includes("admin"),
      hasRole,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      refreshProfile,
    };
  }, [
    status,
    session,
    user,
    profile,
    profileLoading,
    roles,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    updatePassword,
    refreshProfile,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
