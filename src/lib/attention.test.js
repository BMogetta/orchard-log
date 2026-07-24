// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDatabase } from "../data/backend.js";
import { trees, events } from "../data/repository.js";
import { blankTree } from "../data/model.js";
import { computeAttention, parseLocalDate } from "./attention.js";

const DAY = 1000 * 60 * 60 * 24;

describe("parseLocalDate", () => {
  it("pins a YYYY-MM-DD string to the local calendar date (no UTC drift)", () => {
    // The bug this guards: new Date("2023-01-01").getFullYear() is 2022 in UTC-3.
    const d = parseLocalDate("2023-01-01");
    expect(d.getFullYear()).toBe(2023);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });
});

// Season is derived from the current month, and overdue math from Date.now(),
// so every test pins the clock. Southern hemisphere: summer = Oct-Mar.

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.useRealTimers();
});

function daysAgo(now, n) {
  return new Date(now - n * DAY).toISOString().slice(0, 10);
}

describe("computeAttention — care tasks", () => {
  it("flags a task that has never been done as overdue", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-15T00:00:00Z"));
    await trees.save({
      ...blankTree(),
      commonName: "Fig",
      careSchedule: [{ task: "water", intervalDays: 7, lastDone: null }],
    });

    const items = await computeAttention();
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("task");
    expect(items[0].label).toBe("water");
    expect(items[0].treeName).toBe("Fig");
  });

  it("uses the seasonal override when present (winter interval avoids overdue)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // July = winter in the southern hemisphere.
    const now = new Date("2026-07-15T00:00:00Z").getTime();
    vi.setSystemTime(now);
    await trees.save({
      ...blankTree(),
      careSchedule: [
        {
          task: "feed",
          intervalDays: 30,
          intervalDaysWinter: 60,
          lastDone: daysAgo(now, 40),
        },
      ],
    });

    // 40 days since last done, winter interval is 60 -> not due yet.
    const items = await computeAttention();
    expect(items).toHaveLength(0);
  });

  it("falls back to the default interval when the season has no override", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // January = summer; the task only defines a winter override, so summer
    // uses the 30-day default and 40 days makes it overdue.
    const now = new Date("2026-01-15T00:00:00Z").getTime();
    vi.setSystemTime(now);
    await trees.save({
      ...blankTree(),
      careSchedule: [
        {
          task: "feed",
          intervalDays: 30,
          intervalDaysWinter: 60,
          lastDone: daysAgo(now, 40),
        },
      ],
    });

    const items = await computeAttention();
    expect(items).toHaveLength(1);
    expect(items[0].overdueDays).toBe(10);
  });
});

describe("computeAttention — repot suggestion", () => {
  it("suggests a repot when the last one is older than repotYears", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date("2026-07-15T00:00:00Z").getTime();
    vi.setSystemTime(now);
    const id = await trees.save({ ...blankTree(), commonName: "Olive" });
    // Jan 1st: the exact date the UTC-parsing bug used to mislabel as the prior
    // year. parseLocalDate keeps it 2023.
    await events.add({ treeId: id, type: "repot", date: "2023-01-01" });

    const items = await computeAttention(2);
    const repot = items.find((i) => i.kind === "repot");
    expect(repot).toBeDefined();
    expect(repot.labelParams.year).toBe(2023);
  });

  it("does not suggest a repot done within repotYears", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date("2026-07-15T00:00:00Z").getTime();
    vi.setSystemTime(now);
    const id = await trees.save({ ...blankTree() });
    await events.add({ treeId: id, type: "repot", date: "2026-01-01" });

    const items = await computeAttention(2);
    expect(items.find((i) => i.kind === "repot")).toBeUndefined();
  });
});
