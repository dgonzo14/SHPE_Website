/** Resolve a public asset path against the Vite base URL (works on Netlify and GitHub Pages). */
export function assetUrl(path: string): string {
  // All leading slashes, not just the first: "//host" is protocol-relative, so
  // stripping one would leave "/host" and still escape the base path. Every
  // caller passes a hardcoded literal today, which is why this is hardening
  // rather than a fix -- resolveResourceLink in Resources.tsx handles the
  // user-supplied case, backslashes included.
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
}
