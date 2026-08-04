import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { I18nProvider } from "./lib/i18n.jsx";
import { migrateFromDexie } from "./data/migrate.js";
import { startSyncIfConfigured } from "./data/sync.js";
import { isDemo, seedDemoData } from "./lib/demo.js";
import "./styles.css";

// Migrate any legacy Dexie data into PouchDB once, then (demo only) seed the
// sample terrace. Fire-and-forget: useLive picks up inserts via the changes
// feed as they land.
migrateFromDexie()
  .catch((err) => console.error("dexie migration failed", err))
  .finally(() => {
    if (isDemo) seedDemoData();
  });

// Optional live sync to a remote CouchDB. No-op unless VITE_COUCHDB_URL is set,
// so the default build stays local-first. The demo build never syncs.
if (!isDemo) startSyncIfConfigured();

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <App />
  </I18nProvider>
);
