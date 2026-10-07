import type { SVGProps } from "react";
import {
  CalendarClock,
  CodeXml,
  Github,
  Handshake,
  Instagram,
  Linkedin,
  MessageCircle,
  Twitter,
  Youtube,
  type LucideIcon,
} from "lucide-react";

/**
 * Every brand mark on a card, in one module.
 *
 * Brand icons are the part of an icon set most likely to change (lucide has
 * deprecated its brand marks, and companies rename themselves), so they are
 * isolated here: swapping one is a one-line change that touches nothing else.
 * Where lucide has no mark, a neutral icon that says what the link is for
 * (Handshake, Devpost's code, Calendly's calendar, Discord's chat) stands in,
 * except TikTok, whose note is simple enough to draw in lucide's own style.
 *
 * Every icon is decorative: the link's text label always carries the meaning,
 * so they are hidden from assistive technology.
 */

interface IconProps {
  className?: string;
}

function fromLucide(Icon: LucideIcon, name: string) {
  function BrandIcon({ className }: IconProps) {
    return <Icon className={className} aria-hidden="true" focusable="false" />;
  }
  BrandIcon.displayName = name;
  return BrandIcon;
}

export const LinkedinIcon = fromLucide(Linkedin, "LinkedinIcon");
export const GithubIcon = fromLucide(Github, "GithubIcon");
export const InstagramIcon = fromLucide(Instagram, "InstagramIcon");
export const YoutubeIcon = fromLucide(Youtube, "YoutubeIcon");
/** lucide still calls it Twitter. */
export const XIcon = fromLucide(Twitter, "XIcon");
export const HandshakeIcon = fromLucide(Handshake, "HandshakeIcon");
export const DevpostIcon = fromLucide(CodeXml, "DevpostIcon");
export const CalendlyIcon = fromLucide(CalendarClock, "CalendlyIcon");
export const DiscordIcon = fromLucide(MessageCircle, "DiscordIcon");

/** A musical note in lucide's 24px, 2px-stroke grid, so it sits with the rest. */
export function TiktokIcon({ className, ...rest }: IconProps & Omit<SVGProps<SVGSVGElement>, "children">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M15 3.5c.4 2.4 2 4 4.5 4.3" />
      <path d="M15 3.5V15a4.5 4.5 0 1 1-4.5-4.5" />
    </svg>
  );
}
