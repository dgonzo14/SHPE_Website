import type { ComponentType } from "react";
import { LinkButton } from "@/components/ui/button";
import { useAuth } from "@/auth/useAuth";
import { isSupabaseConfigured } from "@/lib/supabase";

/**
 * The bridge from the public site into the member portal.
 *
 * Adapts to who is reading it: a visitor gets "Member Login", a signed-in
 * member gets a direct link into My SHPE. If the deployment has no Supabase
 * credentials it renders nothing rather than advertising a door that does not
 * open.
 */
export function MemberPortalCallout({
  headingId,
  title,
  description,
  icon: Icon,
}: {
  headingId: string;
  title: string;
  description: string;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  const { status } = useAuth();

  if (!isSupabaseConfigured) return null;

  const signedIn = status === "signed-in";

  return (
    <div className="flex flex-col items-start gap-4 rounded-2xl border-2 border-[#5B9BD5] bg-[#E8F4F8] p-6 sm:flex-row sm:items-center sm:p-8">
      {Icon && (
        <span className="rounded-xl bg-white p-3 shadow-sm" aria-hidden>
          <Icon className="h-7 w-7 text-[#E84E1B]" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 id={headingId} className="text-xl font-bold text-[#1B365D] sm:text-2xl">
          {title}
        </h2>
        <p className="mt-1 text-sm text-gray-700 sm:text-base">{description}</p>
      </div>
      <LinkButton
        to={signedIn ? "/portal" : "/login"}
        size="lg"
        className="w-full shrink-0 sm:w-auto"
      >
        {signedIn ? "Open My SHPE" : "Member Login"}
      </LinkButton>
    </div>
  );
}
