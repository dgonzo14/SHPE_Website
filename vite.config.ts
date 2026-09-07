/**
 * vite.config.ts — WashU SHPE
 *
 * DEPLOYMENT BASE PATH
 * --------------------
 * Production is Netlify, at a root domain, so `base` defaults to "/".
 *
 * The chapter moved off GitHub Pages because Pages cannot set HTTP response
 * headers at all — the Content-Security-Policy, HSTS and Permissions-Policy in
 * netlify.toml are simply inert there, which is not a reasonable place to serve
 * a portal holding member data from.
 *
 * `base` stays env-driven rather than hard-coded so a sub-path deployment is
 * still one variable away:
 *
 *   npm run build                                → "/"              (Netlify)
 *   VITE_BASE_PATH=/SHPE_Website/ npm run build  → "/SHPE_Website/" (GitHub Pages)
 *
 * The value is exposed as import.meta.env.BASE_URL and consumed by App.tsx for
 * React Router's basename and by lib/assets.ts for public assets, so routing
 * AND asset loading follow from this single setting.
 */

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const DEFAULT_BASE = "/";

/*
 * The GitHub Pages SPA shim (a generated 404.html plus a decoder inlined in
 * index.html) used to live here. Both halves are gone:
 *
 *   - Netlify rewrites every unmatched path to index.html via netlify.toml, so
 *     nothing on this deployment ever reaches a 404.html.
 *   - The inline decoder was the only script that forced 'unsafe-inline' into
 *     script-src, which is the one control that matters if an XSS ever lands,
 *     because Supabase keeps its session in localStorage.
 *
 * The pair was also already broken: the generator emitted "/?p=/route" while
 * the decoder tested `search[1] === "/"`, so it never fired on a real Pages
 * deep link anyway.
 *
 * If this site ever needs a sub-path static host again, restore both halves
 * together and re-add 'unsafe-inline' (or a sha256 hash of the decoder) to the
 * CSP in netlify.toml.
 */

/** Normalise to a leading+trailing slash form, which is what Vite expects. */
function normaliseBase(raw: string | undefined): string {
  if (!raw) return DEFAULT_BASE;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}

export default defineConfig(({ mode }) => {
  // loadEnv also picks the value up from .env files, not just process.env,
  // so `VITE_BASE_PATH=/` in .env.local works for local Netlify-style dev.
  const env = loadEnv(mode, process.cwd(), "");
  const base = normaliseBase(env.VITE_BASE_PATH ?? process.env.VITE_BASE_PATH);

  return {
    plugins: [react()],

    base,

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },

    build: {
      target: "es2020",
      sourcemap: false,
      chunkSizeWarningLimit: 700,

      rollupOptions: {
        // Explicit entry point → guarantees Vite uses index.html/main.tsx
        input: path.resolve(__dirname, "index.html"),

        output: {
          /**
           * Split vendor code so the browser can cache framework code
           * independently of app code. Supabase and React Query are only
           * pulled in by portal/admin chunks, so they get their own bundles
           * and are never shipped to a public-site-only visitor.
           */
          manualChunks(id) {
            if (
              id.includes("node_modules/react/") ||
              id.includes("node_modules/react-dom/") ||
              id.includes("node_modules/react-router/") ||
              id.includes("node_modules/react-router-dom/") ||
              id.includes("node_modules/scheduler/")
            ) {
              return "vendor-react";
            }
            if (id.includes("node_modules/lucide-react/")) {
              return "vendor-icons";
            }
            if (id.includes("node_modules/@supabase/")) {
              return "vendor-supabase";
            }
            if (id.includes("node_modules/@tanstack/")) {
              return "vendor-query";
            }
            if (
              id.includes("node_modules/react-hook-form/") ||
              id.includes("node_modules/@hookform/") ||
              id.includes("node_modules/zod/")
            ) {
              return "vendor-forms";
            }
          },

          chunkFileNames: "assets/js/[name]-[hash].js",
          entryFileNames: "assets/js/[name]-[hash].js",
          assetFileNames: "assets/[ext]/[name]-[hash].[ext]",
        },
      },
    },

    // Inline only tiny assets (< 4 kB); keep images as separate files
    // so the browser can lazy-load and cache them individually.
    assetsInlineLimit: 4096,

    server: {
      port: 5173,
    },
  };
});
