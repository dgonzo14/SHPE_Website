import type { Context } from "@netlify/functions";

/**
 * Liveness check at the default path, /.netlify/functions/health.
 *
 * The rate limit below is best effort, not a real limit. The counts live in
 * this function instance's memory, and Netlify runs functions on AWS Lambda:
 * a cold start begins with an empty map, and concurrent requests can land on
 * separate instances that each count on their own. All it does is slow down a
 * single client hammering one warm instance. A limit that has to hold needs
 * Netlify's own `rateLimit` in `export const config` (enforced at the edge,
 * plan permitting) or shared state such as Netlify Blobs.
 */
const RATE_LIMIT = 100;
const WINDOW_MS = 60_000;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(clientId: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(clientId);

  if (!entry || now > entry.resetAt) {
    requestCounts.set(clientId, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async (request: Request, context: Context): Promise<Response> => {
  if (request.method === "OPTIONS") {
    // A 204 must have a null body: `new Response("", { status: 204 })` throws.
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // context.ip is the address Netlify itself saw. X-Forwarded-For can carry
  // values the client made up, so keying on it let a client dodge the limit.
  const clientId = context.ip || "unknown";

  if (isRateLimited(clientId)) {
    return Response.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { ...corsHeaders, "Retry-After": "60" },
      },
    );
  }

  return Response.json(
    { status: "ok", timestamp: new Date().toISOString() },
    {
      status: 200,
      headers: { ...corsHeaders, "Cache-Control": "no-store" },
    },
  );
};
