import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Base path for all asset URLs. Defaults to "/" (local dev and LAN deploy,
// both served from the root). GitHub Pages *project* sites serve the app from
// /<repo>/, so set BASE_PATH at build time for that target, e.g.:
//   BASE_PATH=/tree-tracker/ pnpm build
// A user/organisation page (user.github.io) or a custom domain serves from the
// root and needs no override. The PWA scope/start_url follow this same value.
const base = process.env.BASE_PATH ?? "/";

// The app shell is cached for offline use. All user data lives locally in
// IndexedDB (see src/db.js), so no network is ever required to read or write.
export default defineConfig({
  base,
  plugins: [
    react(),
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
});
