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
  const [profileLoading, setProfileLoading] = useState(false);

  // Which member the currently-loaded profile/roles belong to. Guards against a
  // slow response for a previous user landing after a different one signs in.
  const loadedForUserId = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    const supabase = getSupabase();
    setProfileLoading(true);
    try {
      const [profileResult, rolesResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase.from("member_roles").select("role").eq("member_id", userId),
      ]);

      if (loadedForUserId.current !== userId) return;

      if (profileResult.error) throw profileResult.error;
      if (rolesResult.error) throw rolesResult.error;

      setProfile((profileResult.data as ProfileRow | null) ?? null);
      setRoles(((rolesResult.data ?? []) as { role: AppRole }[]).map((r) => r.role));
    } catch (error) {
      if (import.meta.env.DEV) console.error("[shpe] failed to load profile", error);
      if (loadedForUserId.current === userId) {
        setProfile(null);
        setRoles([]);
      }
    } finally {
      if (loadedForUserId.current === userId) setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    let active = true;

    const apply = (next: Session | null) => {
      if (!active) return;
      setSession(next);
      setUser(next?.user ?? null);
      setStatus(next ? "signed-in" : "signed-out");

      const nextId = next?.user?.id ?? null;
      if (nextId !== loadedForUserId.current) {
        loadedForUserId.current = nextId;
        setProfile(null);
        setRoles([]);
        if (nextId) {
          void loadProfile(nextId);
        } else {
          // A different member must never see the previous one's cached data.
          queryClient.clear();
        }
      }
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
  }, [loadProfile, queryClient]);

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
