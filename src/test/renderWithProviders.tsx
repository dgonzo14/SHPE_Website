import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { ToastProvider } from "@/components/ui/ToastProvider";
import type { ProfileRow } from "@/types/database";

export const testProfile: ProfileRow = {
  id: "11111111-1111-4111-8111-111111111111",
  first_name: "Ana",
  last_name: "Rivera",
  email: "ana.rivera@wustl.edu",
  major: "Computer Science",
  secondary_major: null,
  graduation_year: 2028,
  degree_level: "undergraduate",
  shpe_national_member: "self_reported",
  shpe_national_member_id: null,
  linkedin_url: null,
  profile_image_url: null,
  membership_status: "active",
  member_since: "2025-08-25",
  created_at: "2025-08-25T00:00:00.000Z",
  updated_at: "2025-08-25T00:00:00.000Z",
};

function buildAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: "signed-in",
    session: null,
    user: { id: testProfile.id, email: testProfile.email } as AuthContextValue["user"],
    profile: testProfile,
    profileLoading: false,
    roles: ["member"],
    isOfficer: false,
    isAdmin: false,
    hasRole: (role) => (overrides.roles ?? ["member"]).includes(role),
    signIn: async () => {},
    signUp: async () => ({ needsEmailConfirmation: false }),
    signOut: async () => {},
    requestPasswordReset: async () => {},
    updatePassword: async () => {},
    refreshProfile: async () => {},
    ...overrides,
  };
}

/**
 * Renders a component with the providers it would have in the real app, and a
 * fake auth value so tests can describe "an active member" or "a suspended
 * member" directly instead of driving a login flow.
 *
 * Retries are off: a test asserting an error path should not wait for two
 * silent retries first.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { auth?: Partial<AuthContextValue>; route?: string } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={buildAuthValue(options.auth)}>
          <ToastProvider>
            <MemoryRouter initialEntries={[options.route ?? "/portal/check-in"]}>
              {children}
            </MemoryRouter>
          </ToastProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper }) };
}
