import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Base path for all asset URLs. Defaults to "/" (local dev and LAN deploy,
// both served from the root). GitHub Pages *project* sites serve the app from
// /<repo>/, so set BASE_PATH at build time for that target, e.g.:
//   BASE_PATH=/tree-tracker/ pnpm build
// A user/organisation page (user.github.io) or a custom domain serves from the
// root and needs no override. The PWA scope/start_url follow this same value.
const base = process.env.BASE_PATH ?? "/";

// The page CSP (in index.html) locks connect-src to same-origin so the default
// build makes no external calls. When optional CouchDB sync is configured
// (VITE_COUCHDB_URL), the browser must be allowed to reach exactly that origin
// — otherwise it refuses the replication request ("Refused to connect"). This
// plugin widens connect-src by precisely the configured origin at build time,
// and does nothing when sync is off, so demo / local-only builds stay locked.
function couchdbCsp(rawUrl) {
  let origin = null;
  if (rawUrl && rawUrl.trim()) {
    try {
      origin = new URL(rawUrl.trim()).origin;
    } catch {
      origin = null; // malformed URL -> leave the CSP untouched
    }
  }
  return {
    name: "couchdb-connect-src-csp",
    transformIndexHtml(html) {
      if (!origin) return html;
      return html.replace("connect-src 'self'", `connect-src 'self' ${origin}`);
    },
  };
}

// The app shell is cached for offline use. All user data lives locally in
// IndexedDB (see src/db.js); the network is only used for optional CouchDB sync.
export default defineConfig(({ mode }) => {
  // Load .env files (VITE_COUCHDB_URL lives in .env.local for dev). The empty
  // prefix loads all vars; we only read the one we need.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base,
  resolve: {
    alias: {
      // Production storage adapter: the browser's IndexedDB.
      "@adapter": fileURLToPath(new URL("./src/data/adapter.js", import.meta.url)),
    },
  },
  plugins: [
    react(),
    couchdbCsp(env.VITE_COUCHDB_URL),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Orchard Log",
        short_name: "Orchard",
        description: "Clinical history for your potted fruit trees",
        theme_color: "#2f5233",
        background_color: "#f7f4ec",
        display: "standalone",
        scope: base,
        start_url: base,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
    ],
  };
});
