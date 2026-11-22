import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  daysSinceExport,
  getBackupState,
  markExported,
  refreshBackupState,
  shouldRemind,
  snoozeReminder,
  subscribeBackupState,
  REMIND_AFTER_DAYS,
  SNOOZE_DAYS,
} from "./backupReminder.js";

if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-22T12:00:00.000Z");
const LAST = "orchard-log:last-export";
const SNOOZE = "orchard-log:backup-snoozed-until";

beforeEach(() => {
  localStorage.removeItem(LAST);
  localStorage.removeItem(SNOOZE);
  refreshBackupState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shouldRemind", () => {
  const base = { now: NOW, lastExport: null, snoozedUntil: null, hasData: true };

  it("stays quiet while there is nothing to lose", () => {
    expect(shouldRemind({ ...base, hasData: false })).toBe(false);
  });

  it("reminds when a backup was never exported", () => {
    expect(shouldRemind(base)).toBe(true);
  });

  it("reminds only once the last export is old enough", () => {
    const daysAgo = (n) => NOW - n * DAY;
    expect(shouldRemind({ ...base, lastExport: daysAgo(REMIND_AFTER_DAYS - 1) })).toBe(
      false
    );
    expect(shouldRemind({ ...base, lastExport: daysAgo(REMIND_AFTER_DAYS) })).toBe(true);
    expect(shouldRemind({ ...base, lastExport: daysAgo(0) })).toBe(false);
  });

  it("respects a snooze, and comes back when it ends", () => {
    expect(shouldRemind({ ...base, snoozedUntil: NOW + 1 })).toBe(false);
    expect(shouldRemind({ ...base, snoozedUntil: NOW })).toBe(true);
    expect(shouldRemind({ ...base, snoozedUntil: NOW - DAY })).toBe(true);
  });

  it("does not let a date from the future hide it forever", () => {
    expect(shouldRemind({ ...base, lastExport: NOW + 400 * DAY })).toBe(true);
    expect(shouldRemind({ ...base, lastExport: NOW + 2 * DAY })).toBe(true);
  });

  it("takes a date slightly ahead (a corrected clock) as a recent export", () => {
    expect(shouldRemind({ ...base, lastExport: NOW + 60 * 60 * 1000 })).toBe(false);
  });

  it("never honours a snooze longer than the snooze itself", () => {
    const farFuture = Date.parse("9999-01-01T00:00:00.000Z");
    expect(shouldRemind({ ...base, snoozedUntil: farFuture })).toBe(true);
    expect(shouldRemind({ ...base, snoozedUntil: NOW + (SNOOZE_DAYS + 1) * DAY })).toBe(
      true
    );
    expect(shouldRemind({ ...base, snoozedUntil: NOW + SNOOZE_DAYS * DAY })).toBe(false);
  });
});

describe("daysSinceExport", () => {
  it("counts whole days, and has no answer without a usable date", () => {
    expect(daysSinceExport(NOW, NOW - 45 * DAY - 1000)).toBe(45);
    expect(daysSinceExport(NOW, NOW)).toBe(0);
    expect(daysSinceExport(NOW, null)).toBeNull();
    expect(daysSinceExport(NOW, NOW + 60 * 60 * 1000)).toBe(0); // clock corrected a little
    expect(daysSinceExport(NOW, NOW + 2 * DAY)).toBeNull();
  });
});

describe("stored state", () => {
  it("records an export and a snooze, and tells subscribers", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeBackupState(seen);

    markExported(NOW);
    expect(getBackupState().lastExport).toBe(NOW);
    snoozeReminder(NOW);
    expect(getBackupState().snoozedUntil).toBe(NOW + SNOOZE_DAYS * DAY);
    expect(seen).toHaveBeenCalledTimes(2);

    unsubscribe();
    markExported(NOW + DAY);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("keeps the same snapshot object until something changes", () => {
    expect(getBackupState()).toBe(getBackupState());
  });

  it("treats a stored value that is not a date as absent", () => {
    localStorage.setItem(LAST, "<script>alert(1)</script>");
    localStorage.setItem(SNOOZE, "not a date");
    refreshBackupState();
    expect(getBackupState()).toEqual({ lastExport: null, snoozedUntil: null });
  });

  it("reads an unbelievable export date as no export at all", () => {
    localStorage.setItem(LAST, "9999-01-01T00:00:00.000Z");
    refreshBackupState();
    expect(getBackupState().lastExport).toBeNull();
  });

  it("works when storage throws", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => markExported(NOW)).not.toThrow();
    expect(() => snoozeReminder(NOW)).not.toThrow();
    expect(getBackupState()).toEqual({ lastExport: null, snoozedUntil: null });
  });
});
