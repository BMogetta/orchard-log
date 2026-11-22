import React, { useState, useSyncExternalStore } from "react";
import { trees, useLive, getSyncStatus, subscribeSyncStatus } from "../data";
import { exportBackup } from "../lib/backup.js";
import {
  daysSinceExport,
  getBackupState,
  shouldRemind,
  snoozeReminder,
  subscribeBackupState,
} from "../lib/backupReminder.js";
import { isDemo } from "../lib/demo.js";
import { useT } from "../lib/i18n.jsx";

// Shown now and then to whoever owns the data on this device: the editor, or
// anyone on a build without sync. Not to read-only accounts or while the role
// is still unknown (it is not theirs to look after), and never in the demo.
export default function BackupReminder() {
  const { t } = useT();
  const { state, role } = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const { lastExport, snoozedUntil } = useSyncExternalStore(
    subscribeBackupState,
    getBackupState
  );
  const count = useLive(async () => (await trees.all()).length, [], 0);
  // null | "incomplete" | "failed": why the last attempt did not settle it.
  const [problem, setProblem] = useState(null);

  const owner = state === "off" || role === "editor";
  const now = Date.now();
  const remind =
    !isDemo &&
    owner &&
    shouldRemind({ now, lastExport, snoozedUntil, hasData: count > 0 });
  if (!remind) return null;

  async function exportNow() {
    try {
      const { complete } = await exportBackup();
      setProblem(complete ? null : "incomplete");
    } catch {
      setProblem("failed");
    }
  }

  const days = daysSinceExport(now, lastExport);
  const message = problem
    ? t(`backup.${problem}`)
    : days === null
      ? t("backupReminder.never")
      : t("backupReminder.stale", { n: days });
  return (
    <div className="sync-banner" role="status">
      <span>{message}</span>
      <span className="row-gap">
        <button className="link" onClick={exportNow}>
          {t("backupReminder.exportNow")}
        </button>
        <button className="link" onClick={() => snoozeReminder()}>
          {t("backupReminder.later")}
        </button>
      </span>
    </div>
  );
}
