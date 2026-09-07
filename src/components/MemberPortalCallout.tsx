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
    /*
     * The bridge into the portal, so it should look like the portal: a hairline
     * rule and a flat tint rather than a 2px light-blue border, a rounded
     * corner and a shadowed icon chip. The orange bar down the left is the same
     * device the mobile nav uses to mark the current page.
     */
    <div className="flex flex-col items-start gap-5 border border-shpe-rule border-l-4 border-l-shpe-orange bg-shpe-navy-soft p-6 sm:flex-row sm:items-center sm:p-8">
      {Icon && <Icon className="h-8 w-8 shrink-0 text-shpe-navy" aria-hidden />}
      <div className="min-w-0 flex-1">
        <h2 id={headingId} className="text-xl font-bold tracking-tight text-shpe-navy sm:text-2xl">
          {title}
        </h2>
        <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-gray-700 sm:text-base">
          {description}
        </p>
      </div>
      <LinkButton to={signedIn ? "/portal" : "/login"} size="lg" className="w-full shrink-0 sm:w-auto">
        {signedIn ? "Open My SHPE" : "Member Login"}
      </LinkButton>
    </div>
  );
}
