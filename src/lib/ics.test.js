// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildCareTaskIcs } from "./ics.js";

// TZ is pinned to UTC by the test runner, so floating local stamps are
// deterministic here.
const now = new Date("2026-08-04T12:00:00Z");
const base = { treeName: "Meyer Lemon", treeId: "tree:abc", index: 0, now };

describe("buildCareTaskIcs", () => {
  it("emits a valid recurring VCALENDAR with an alarm", () => {
    const ics = buildCareTaskIcs({
      ...base,
      task: { task: "Water check", intervalDays: 7, lastDone: null },
    });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("RRULE:FREQ=DAILY;INTERVAL=7");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("UID:tree:abc-care-0@orchard-log");
    // CRLF line endings, as required by RFC 5545.
    expect(ics).toContain("\r\n");
  });

  it("summarises as '<task> · <tree>' and escapes TEXT", () => {
    const ics = buildCareTaskIcs({
      ...base,
      task: { task: "Water, check", intervalDays: 3, lastDone: null },
    });
    expect(ics).toContain("SUMMARY:Water\\, check · Meyer Lemon");
  });

  it("starts today at 09:00 when the task was never done", () => {
    const ics = buildCareTaskIcs({
      ...base,
      task: { task: "Feed", intervalDays: 30, lastDone: null },
    });
    expect(ics).toContain("DTSTART:20260804T090000");
  });

  it("starts at lastDone + interval when the task has been done", () => {
    const ics = buildCareTaskIcs({
      ...base,
      task: { task: "Feed", intervalDays: 7, lastDone: "2026-08-01" },
    });
    expect(ics).toContain("DTSTART:20260808T090000");
  });

  it("defaults a missing/invalid interval to a daily recurrence", () => {
    const ics = buildCareTaskIcs({
      ...base,
      task: { task: "Check", intervalDays: 0, lastDone: null },
    });
    expect(ics).toContain("RRULE:FREQ=DAILY;INTERVAL=1");
  });
});
