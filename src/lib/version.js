// The version and commit of this build, injected by vite.config.js. The version
// comes from package.json, which the release tool maintains; the commit is the
// one the deploy was built from. Shown in the app so anyone can tell at a
// glance which build a device is running, e.g. a tab left open across deploys.
/* global __APP_VERSION__, __APP_COMMIT__ */
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
export const APP_COMMIT = typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "";

// "1.2.0 (abc1234)", or just the version for a build made outside CI.
export const BUILD_LABEL = APP_COMMIT ? `${APP_VERSION} (${APP_COMMIT})` : APP_VERSION;
