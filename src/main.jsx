import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { I18nProvider } from "./lib/i18n.jsx";
import { isDemo, seedDemoData } from "./lib/demo.js";
import "./styles.css";

// In demo builds, seed the sample terrace before the first paint. Fire-and-
// forget: useLiveQuery picks up the inserts as they land.
if (isDemo) seedDemoData();

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <App />
  </I18nProvider>
);
