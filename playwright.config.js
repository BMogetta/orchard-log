import { defineConfig, devices } from "@playwright/test";

// Browser tests against the whole app as it ships: the production build with
// its service worker, served by the same local runtime that runs the API, on
// a throwaway database and photo bucket. The only part of production left out
// is Cloudflare Access.
const PORT = 8799;
const STATE = ".wrangler/e2e";
// Stands in for the signed-in editor. The API honours it on localhost only.
// Given on the command line so the run does not depend on, or create, the
// developer's own .dev.vars (command-line values win over that file).
const IDENTITY = "e2e@example.com";

// One command so the pieces cannot drift apart: fresh state, a build labelled
// as a known commit, the schema, then the server.
const serve = [
  `rm -rf ${STATE}`,
  "VITE_SYNC=1 GITHUB_SHA=aaaaaaa1 pnpm build",
  `pnpm exec wrangler d1 migrations apply orchard --local --persist-to ${STATE}`,
  [
    `pnpm exec wrangler pages dev dist --port ${PORT} --persist-to ${STATE}`,
    "--show-interactive-dev-session=false",
    `--binding DEV_USER_EMAIL=${IDENTITY} --binding EDITOR_EMAIL=${IDENTITY}`,
  ].join(" "),
].join(" && ");

export default defineConfig({
  testDir: "e2e",
  // The tests share one server and one database, and the last one replaces
  // the build being served, so they run one at a time, in file order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: serve,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
