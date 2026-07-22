import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.js on purpose: tests don't need the PWA plugin,
// and this keeps the build config free of test concerns.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.js"],
    globals: true,
    include: ["src/**/*.test.{js,jsx}", "test/**/*.test.{js,jsx}"],
  },
});
