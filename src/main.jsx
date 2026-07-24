import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { I18nProvider } from "./lib/i18n.jsx";
import { migrateFromDexie } from "./data/migrate.js";
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

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <App />
  </I18nProvider>
);
