import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.js on purpose: tests don't need the PWA plugin.
// The @adapter alias points at the in-memory PouchDB adapter here (prod uses
// the idb adapter via vite.config.js), avoiding fake-indexeddb flakiness.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@adapter": fileURLToPath(new URL("./src/data/adapter.memory.js", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.js"],
    globals: true,
    include: ["src/**/*.test.{js,jsx}", "test/**/*.test.{js,jsx}"],
  },
});
