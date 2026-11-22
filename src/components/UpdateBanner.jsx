import React, { useSyncExternalStore } from "react";
import { getSyncStatus, subscribeSyncStatus } from "../data";
import { useT } from "../lib/i18n.jsx";
import {
  isUpdateAvailable,
  reloadToLatest,
  subscribeUpdateAvailable,
} from "../lib/update.js";

// Offers a reload when a newer build has been installed behind this page.
// Stays out of the way when the sync banner is already asking for the same
// thing (the API refused this build as too old).
export default function UpdateBanner() {
  const { t } = useT();
  const available = useSyncExternalStore(subscribeUpdateAvailable, isUpdateAvailable);
  const { state } = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);

  if (!available || state === "outdated") return null;
  return (
    <div className="sync-banner" role="status">
      <span>{t("update.available")}</span>
      <button className="link" onClick={() => reloadToLatest()}>
        {t("sync.reload")}
      </button>
    </div>
  );
}
