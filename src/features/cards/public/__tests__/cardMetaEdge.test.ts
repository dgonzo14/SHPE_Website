// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CardTheme } from "../../model";

/*
 * The card-meta edge function (netlify/edge-functions/card-meta.ts), run for
 * real against a stubbed Supabase and a stubbed page.
 *
 * It's loaded through import.meta.glob rather than imported: it's written for
 * Netlify's Deno runtime (a `Netlify` global, types from a URL), which the
 * app's TypeScript config doesn't describe, and a static import would pull it
 * into that check. Vitest runs it fine, and the node environment is the
 * closest thing to the edge here.
 */

type EdgeHandler = (request: Request, context: { next: () => Promise<Response> }) => Promise<Response>;

const EDGE_FUNCTION = "/netlify/edge-functions/card-meta.ts";
const edgeModules = import.meta.glob<{ default: EdgeHandler }>("/netlify/edge-functions/card-meta.ts");

async function loadHandler(): Promise<EdgeHandler> {
  const load = edgeModules[EDGE_FUNCTION];
  if (!load) throw new Error(`${EDGE_FUNCTION} not found`);
  return (await load()).default;
}

const SUPABASE_URL = "https://abc.supabase.co";
const MEMBER = "11111111-1111-4111-8111-111111111111";
const AVATAR = `${MEMBER}/22222222-2222-4222-8222-222222222222.webp`;
const AVATAR_URL = `${SUPABASE_URL}/storage/v1/object/public/card-media/${AVATAR}`;

// A stray og:image proves the function also removes any the page came with.
const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>WashU SHPE</title>
    <meta name="description" content="Chapter site" />
    <meta property="og:image" content="https://washushpe.org/old.png" />
  </head>
  <body><div id="root"></div></body>
</html>`;

function card(theme: CardTheme | Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    handle: "diego-gonzalez",
    display_name: "Diego Gonzalez",
    headline: "SWE Intern @ Boeing",
    organization: "Washington University in St. Louis",
    avatar_path: AVATAR,
    theme,
    allow_indexing: false,
    is_starter: false,
    shpe: { position: "President" },
    ...overrides,
  };
}

async function headFor(cardData: Record<string, unknown>): Promise<string> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ status: "ok", card: cardData })),
  );
  const handler = await loadHandler();
  const response = await handler(
    new Request("https://washushpe.org/card/diego-gonzalez", { headers: { accept: "text/html" } }),
    { next: async () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }) },
  );
  expect(response.status).toBe(200);
  const html = await response.text();
  return html.slice(0, html.indexOf("</head>"));
}

const ogImage = (head: string) => /<meta property="og:image" content="([^"]*)"/.exec(head)?.[1] ?? null;

beforeEach(() => {
  const env: Record<string, string> = {
    VITE_SUPABASE_URL: SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: "anon-key",
    VITE_SITE_URL: "https://washushpe.org",
  };
  vi.stubGlobal("Netlify", { env: { get: (name: string) => env[name] } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("card-meta edge function: the preview photo", () => {
  it("uses the card's photo when the design shows it", async () => {
    const head = await headFor(card({ preset: "shpe-classic" }));
    expect(ogImage(head)).toBe(AVATAR_URL);
    expect(head).toContain('<meta property="og:image:alt" content="Photo of Diego Gonzalez" />');
    expect(head).toContain("<title>Diego Gonzalez | WashU SHPE</title>");
  });

  it.each<[string, CardTheme]>([
    ["the Paper preset (Minimal layout by default)", { preset: "paper" }],
    ["the Minimal layout on another preset", { preset: "shpe-classic", layout: "minimal" }],
    ["the No photo shape", { preset: "shpe-classic", avatar: { shape: "hidden" } }],
    ["the No photo shape on a preset with a banner", { preset: "sunrise", avatar: { shape: "hidden", ring: true } }],
  ])("leaves the photo out for %s", async (_name, theme) => {
    const head = await headFor(card(theme));
    expect(ogImage(head)).toBeNull();
    expect(head).not.toContain("og:image");
    expect(head).not.toContain(AVATAR);
    // The rest of the preview is still the member's.
    expect(head).toContain('<meta property="og:title" content="Diego Gonzalez" />');
  });

  it("shows the photo again when Paper is switched to a layout that has one", async () => {
    const head = await headFor(card({ preset: "paper", layout: "classic" }));
    expect(ogImage(head)).toBe(AVATAR_URL);
  });

  it("reads a junk theme the way the card does (SHPE Classic, photo shown)", async () => {
    const head = await headFor(card({ preset: "nope", layout: 7, avatar: "hidden" }));
    expect(ogImage(head)).toBe(AVATAR_URL);
  });

  it("never uses a photo on a starter card", async () => {
    const head = await headFor(card({ preset: "shpe-classic" }, { is_starter: true }));
    expect(ogImage(head)).toBeNull();
  });
});

/*
 * Netlify bundles the edge function with Deno, which resolves imports more
 * strictly than Vite: relative paths need their ".ts", and there is no "@/"
 * alias and no node_modules. A file that breaks those rules passes every
 * other check and then fails the deploy, so this walks everything the edge
 * function imports and holds each import to them.
 */
describe("card-meta edge function: what it imports", () => {
  const sources = import.meta.glob<string>(
    ["/netlify/edge-functions/**/*.ts", "/src/features/cards/*.ts"],
    { query: "?raw", import: "default", eager: true },
  );

  // `import ... from "x"`, `export ... from "x"` and `import("x")`.
  const SPECIFIER = /\b(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  function importsOf(source: string): { specifier: string; typeOnly: boolean }[] {
    // Comments can mention import syntax; only real statements count.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    return [...code.matchAll(SPECIFIER)].map((m) => ({
      specifier: m[1] ?? m[2],
      typeOnly: /^\s*(?:import|export)\s+type\b/.test(m[0]),
    }));
  }

  it("reaches only local .ts files by relative path, and no packages", () => {
    const seen = new Set<string>();
    const problems: string[] = [];
    const queue = [EDGE_FUNCTION];

    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = sources[file];
      if (source === undefined) {
        problems.push(`${file} isn't a file this test can read; keep edge imports in src/features/cards/`);
        continue;
      }
      for (const { specifier, typeOnly } of importsOf(source)) {
        // Type-only imports are erased before Deno runs anything; the Netlify
        // types come from a URL, which Deno can fetch anyway.
        if (typeOnly && specifier.startsWith("https://")) continue;
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
          problems.push(`${file} imports "${specifier}", which Deno can't resolve`);
          continue;
        }
        if (!specifier.endsWith(".ts")) {
          problems.push(`${file} imports "${specifier}" without its .ts extension`);
          continue;
        }
        queue.push(new URL(specifier, `file://${file}`).pathname);
      }
    }

    expect(problems).toEqual([]);
    // The test is only worth something if it really followed the imports.
    expect([...seen]).toContain("/src/features/cards/photoVisibility.ts");
    expect([...seen]).toContain("/src/features/cards/model.ts");
  });

  it("would catch an aliased or extensionless import", () => {
    expect(importsOf('import { a } from "@/lib/x";\nimport b from "./y";')).toEqual([
      { specifier: "@/lib/x", typeOnly: false },
      { specifier: "./y", typeOnly: false },
    ]);
    expect(importsOf('import type { C } from "https://edge.netlify.com";')).toEqual([
      { specifier: "https://edge.netlify.com", typeOnly: true },
    ]);
  });
});
