import { createContext } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { AppRole, ProfileRow } from "@/types/database";
import type { RegisterValues } from "@/lib/validation";

/**
 * `loading` exists so route guards can wait instead of guessing.
 * Without it every protected page would flash the login screen for one frame
 * while the stored session is restored.
 */
export type AuthStatus = "loading" | "signed-in" | "signed-out" | "unconfigured";

/**
 * Sign-in and sign-up wait out the shared per-IP rate limit rather than
 * failing, which means they can take tens of seconds when a whole meeting
 * registers at once. `onRetry` lets the form say so instead of spinning
 * silently — see lib/retry.ts.
 */
export interface AuthAttemptOptions {
  onRetry?: (attempt: number) => void;
}

export interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  user: User | null;

  /** null until the profile row has loaded, or if the portal is unconfigured. */
  profile: ProfileRow | null;
  profileLoading: boolean;
  roles: AppRole[];

  isOfficer: boolean;
  isAdmin: boolean;
  hasRole: (role: AppRole) => boolean;

  signIn: (email: string, password: string, opts?: AuthAttemptOptions) => Promise<void>;
  signUp: (
    values: RegisterValues,
    opts?: AuthAttemptOptions,
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
