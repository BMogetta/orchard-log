import PouchDB from "pouchdb-core";
import httpAdapter from "pouchdb-adapter-http";
import replication from "pouchdb-replication";
import { pouch } from "./backend.js";

// ---------------------------------------------------------------------------
// Optional live sync to a remote CouchDB (Phase 3). This is bolted onto the
// same local `pouch` instance the whole app already uses — no data path
// changes, the changes feed (useLive) just starts seeing replicated docs.
//
// Sync is entirely opt-in: with no remote URL the app is local-first as before.
// For dev, the URL comes from VITE_COUCHDB_URL (see .env.local.example); the
// productised settings toggle + credentials UI is deferred.
// ---------------------------------------------------------------------------

PouchDB.plugin(httpAdapter);
PouchDB.plugin(replication);

// Read the remote URL from the build-time env. Empty/undefined -> no sync.
export function configuredRemoteUrl() {
  const url = import.meta.env?.VITE_COUCHDB_URL;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

// Split any basic-auth credentials out of a URL into PouchDB's `auth` option.
// Browsers reject fetch() against a URL that embeds credentials
// (`http://user:pass@host`), and PouchDB 9's http adapter is fetch-based, so
// credentials MUST travel as `auth`, not in the URL string.
function splitCredentials(raw) {
  const u = new URL(raw);
  if (!u.username) return { url: raw, auth: null };
  const auth = {
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
  u.username = "";
  u.password = "";
  return { url: u.toString(), auth };
}

// Start bidirectional live replication against `remoteUrl`. Returns a handle
// with `.cancel()`. `onStatus` receives coarse state transitions:
//   "active" | "paused" | "denied" | "error"
// (paused = caught up / idle, the normal steady state for a live sync).
export function startSync(remoteUrl, onStatus = () => {}) {
  const { url, auth } = splitCredentials(remoteUrl);
  const remote = new PouchDB(url, {
    adapter: "http",
    skip_setup: false,
    ...(auth ? { auth } : {}),
  });

  const handle = pouch
    .sync(remote, { live: true, retry: true })
    .on("active", () => onStatus("active"))
    .on("paused", (err) => onStatus(err ? "error" : "paused"))
    .on("denied", (err) => onStatus("denied", err))
    .on("error", (err) => onStatus("error", err));

  return handle;
}

// Convenience for app boot: start sync iff a remote is configured. Logs coarse
// status to the console so the dev slice is observable without any UI yet.
export function startSyncIfConfigured() {
  const url = configuredRemoteUrl();
  if (!url) return null;
  const redacted = url.replace(/\/\/[^@/]+@/, "//***@");
  console.info(`[sync] live replication -> ${redacted}`);
  return startSync(url, (state, err) => {
    if (state === "error" || state === "denied") {
      console.error(`[sync] ${state}`, err);
    } else {
      console.info(`[sync] ${state}`);
    }
  });
}
