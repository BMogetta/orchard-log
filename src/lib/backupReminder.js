// A gentle reminder to export a backup. The export file is the only copy of
// the data the owner holds outside the app (and outside the sync server), and
// it is easy to forget for months.
//
// Everything here is per device, kept in localStorage: an export downloads a
// file to *this* device, so that is what "last export" means. Nothing is sent
// anywhere and nothing is synced.

const LAST_EXPORT_KEY = "orchard-log:last-export";
const SNOOZED_UNTIL_KEY = "orchard-log:backup-snoozed-until";
const DAY_MS = 24 * 60 * 60 * 1000;

export const REMIND_AFTER_DAYS = 30;
export const SNOOZE_DAYS = 7;

// A stored timestamp, or null when absent, unreadable or not a real date.
function readTime(key) {
  try {
    const time = Date.parse(globalThis.localStorage?.getItem(key) ?? "");
    return Number.isFinite(time) ? time : null;
  } catch {
    return null; // storage blocked
  }
}

function writeTime(key, time) {
  try {
    globalThis.localStorage?.setItem(key, new Date(time).toISOString());
  } catch {
    // storage blocked: the reminder simply shows again
  }
}

// Clocks get corrected. A date slightly in the future is a recent export; one
// far in the future is not believable and is ignored, so that neither a wrong
// clock nor a tampered value can silence the reminder for good.
const CLOCK_TOLERANCE_MS = DAY_MS;

// Pure decision, so it can be tested without a clock or storage.
// lastExport and snoozedUntil are timestamps in ms, or null.
export function shouldRemind({ now, lastExport, snoozedUntil, hasData }) {
  if (!hasData) return false; // nothing to lose yet
  // A snooze lasts SNOOZE_DAYS at most, whatever the stored date says.
  const snoozeLeft = snoozedUntil === null ? 0 : snoozedUntil - now;
  if (snoozeLeft > 0 && snoozeLeft <= SNOOZE_DAYS * DAY_MS) return false;
  if (lastExport === null || lastExport > now + CLOCK_TOLERANCE_MS) return true;
  return now - lastExport >= REMIND_AFTER_DAYS * DAY_MS;
}

// Whole days since the last export, or null when there has never been one.
export function daysSinceExport(now, lastExport) {
  if (lastExport === null || lastExport > now + CLOCK_TOLERANCE_MS) return null;
  return Math.max(0, Math.floor((now - lastExport) / DAY_MS));
}

// --- Small store, so the banner and the Backup menu update together --------

const listeners = new Set();
const read = () => {
  const lastExport = readTime(LAST_EXPORT_KEY);
  return {
    // An unbelievable date reads as "never", so the reminder and the Backup
    // menu say the same thing.
    lastExport:
      lastExport !== null && lastExport > Date.now() + CLOCK_TOLERANCE_MS
        ? null
        : lastExport,
    snoozedUntil: readTime(SNOOZED_UNTIL_KEY),
  };
};
let snapshot = read();

// Re-reads storage and tells subscribers. Also how another tab's export or
// snooze reaches this one (see the listener below).
export function refreshBackupState() {
  snapshot = read();
  for (const listener of listeners) listener();
}

export const getBackupState = () => snapshot;

export function subscribeBackupState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

globalThis.addEventListener?.("storage", (event) => {
  if (
    event.key === LAST_EXPORT_KEY ||
    event.key === SNOOZED_UNTIL_KEY ||
    event.key === null
  ) {
    refreshBackupState();
  }
});

// Called once an export file has been handed to the browser.
export function markExported(now = Date.now()) {
  writeTime(LAST_EXPORT_KEY, now);
  refreshBackupState();
}

export function snoozeReminder(now = Date.now()) {
  writeTime(SNOOZED_UNTIL_KEY, now + SNOOZE_DAYS * DAY_MS);
  refreshBackupState();
}
