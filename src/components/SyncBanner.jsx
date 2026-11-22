import React, { useSyncExternalStore } from "react";
import { getSyncStatus, subscribeSyncStatus } from "../data/index.js";
import { useT } from "../lib/i18n.jsx";
import { reloadToLatest } from "../lib/update.js";

// Says something only when sync needs the user's attention: the session
// expired, this tab runs an old build, the device is offline, sync is failing,
// or this account is read-only. A healthy editor session shows nothing, and so
// does a build without sync.
export default function SyncBanner() {
  const { t } = useT();
  const { state, role } = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);

  if (state === "signed-out") {
    return (
      <div className="sync-banner">
        <span>{t("sync.signedOut")}</span>
        <a className="link" href="/api/login">
          {t("sync.signIn")}
        </a>
      </div>
    );
  }
  if (state === "outdated") {
    return (
      <div className="sync-banner">
        <span>{t("sync.outdated")}</span>
        <button className="link" onClick={() => reloadToLatest()}>
          {t("sync.reload")}
        </button>
      </div>
    );
  }
  if (state === "offline" || state === "error") {
    return (
      <div className="sync-banner">
        <span>{t(`sync.${state}`)}</span>
      </div>
    );
  }
  if (role === "reader") {
    return (
      <div className="sync-banner">
        <span>{t("sync.readOnly")}</span>
      </div>
    );
  }
  return null;
}
