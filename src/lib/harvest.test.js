import { describe, it, expect } from "vitest";
import { harvestTotals } from "./harvest.js";

describe("harvestTotals", () => {
  it("sums yield per year, newest first, keeping a shared unit", () => {
    const events = [
      { type: "harvest", date: "2025-02-01", yieldAmount: 2, yieldUnit: "kg" },
      { type: "harvest", date: "2025-03-15", yieldAmount: 1.5, yieldUnit: "kg" },
      { type: "harvest", date: "2024-02-01", yieldAmount: 3, yieldUnit: "kg" },
      { type: "note", date: "2025-01-01", notes: "irrelevant" },
    ];
    expect(harvestTotals(events)).toEqual([
      { year: 2025, total: 3.5, unit: "kg" },
      { year: 2024, total: 3, unit: "kg" },
    ]);
  });

  it("drops the unit when a year mixes units", () => {
    const events = [
      { type: "harvest", date: "2025-02-01", yieldAmount: 2, yieldUnit: "kg" },
      { type: "harvest", date: "2025-03-01", yieldAmount: 5, yieldUnit: "u" },
    ];
    expect(harvestTotals(events)).toEqual([{ year: 2025, total: 7, unit: "" }]);
  });

  it("ignores harvests without a positive numeric yield", () => {
    const events = [
      { type: "harvest", date: "2025-02-01", yieldAmount: 0, yieldUnit: "kg" },
      { type: "harvest", date: "2025-02-02", yieldUnit: "kg" },
      { type: "harvest", date: "2025-02-03", yieldAmount: "abc" },
    ];
    expect(harvestTotals(events)).toEqual([]);
  });

  it("returns [] for no events", () => {
    expect(harvestTotals([])).toEqual([]);
    expect(harvestTotals(undefined)).toEqual([]);
  });
});
