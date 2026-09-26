import { describe, it, expect } from "vitest";
import { phaseStatus, treePhenology } from "./phenology.js";

// A fixed "today" so the tests are deterministic regardless of the run date.
// parseLocalDate builds local dates, and the suite runs with TZ=UTC.
const today = new Date(2026, 8, 26); // 2026-09-26 (month is 0-based)

describe("phaseStatus", () => {
  it("is 'active' when an observation is within ±2 weeks of today", () => {
    expect(phaseStatus(["2026-09-20"], today)).toBe("active");
    expect(phaseStatus(["2026-10-08"], today)).toBe("active"); // +12 days
  });

  it("is 'predicted' when a PRIOR-year observation recurs near today", () => {
    expect(phaseStatus(["2024-09-22"], today)).toBe("predicted");
    expect(phaseStatus(["2023-10-05"], today)).toBe("predicted");
  });

  it("is 'none' when no observation lands near today on the yearly cycle", () => {
    expect(phaseStatus(["2025-03-01"], today)).toBe("none");
    expect(phaseStatus([], today)).toBe("none");
  });

  it("prefers 'active' over 'predicted' when both apply", () => {
    expect(phaseStatus(["2024-09-24", "2026-09-25"], today)).toBe("active");
  });

  it("wraps the year end (late-Dec bloom matches early-Jan today)", () => {
    const jan = new Date(2026, 0, 3); // 2026-01-03
    expect(phaseStatus(["2024-12-28"], jan)).toBe("predicted");
  });

  it("ignores blank or malformed dates", () => {
    expect(phaseStatus([null, "", "not-a-date"], today)).toBe("none");
  });
});

describe("treePhenology", () => {
  it("derives both phases from the event list, ignoring other event types", () => {
    const events = [
      { type: "flowering", date: "2024-09-25" }, // predicted
      { type: "fruit-set", date: "2026-09-24" }, // active
      { type: "note", date: "2026-09-26", notes: "irrelevant" },
    ];
    expect(treePhenology(events, today)).toEqual({
      flowering: "predicted",
      fruiting: "active",
    });
  });
});
