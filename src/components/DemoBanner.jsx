import React from "react";
import { useT } from "../lib/i18n.jsx";
import { resetDemoData } from "../lib/demo.js";

// Shown only in demo builds (see App.jsx). Tells visitors the data is theirs
// and local, and lets them reset the sample terrace.
export default function DemoBanner() {
  const { t } = useT();

  async function reset() {
    if (confirm(t("demo.resetConfirm"))) await resetDemoData();
  }

  return (
    <div className="demo-banner">
      <span>{t("demo.banner")}</span>
      <button className="link" onClick={reset}>
        {t("demo.reset")}
      </button>
    </div>
  );
}
