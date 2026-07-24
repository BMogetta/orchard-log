// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { estimatedAgeMonths, migrateTreeToV2 } from "./model.js";

// Pure domain-model behaviour, storage-independent.

afterEach(() => {
  vi.useRealTimers();
});

describe("estimatedAgeMonths", () => {
  it("returns null when purchase date or claimed age is missing", () => {
    expect(estimatedAgeMonths({ purchaseDate: "", claimedAgeMonthsAtPurchase: 12 })).toBeNull();
    expect(
      estimatedAgeMonths({ purchaseDate: "2021-01-01", claimedAgeMonthsAtPurchase: null })
    ).toBeNull();
  });

  it("equals the claimed age when no time has passed since purchase", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2021-06-15T00:00:00Z"));
    expect(
      estimatedAgeMonths({ purchaseDate: "2021-06-15", claimedAgeMonthsAtPurchase: 10 })
    ).toBe(10);
  });

  it("adds elapsed months to the claimed age", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2022-06-15T00:00:00Z"));
    expect(
      estimatedAgeMonths({ purchaseDate: "2021-06-15", claimedAgeMonthsAtPurchase: 10 })
    ).toBe(22);
  });
});

describe("migrateTreeToV2 — enum normalisation", () => {
  it("maps legacy free-text sun to the closed enum", () => {
    expect(migrateTreeToV2({ sunSpec: "full sun" }).sunSpec).toBe("full-sun");
    expect(migrateTreeToV2({ sunSpec: "media sombra" }).sunSpec).toBe("part-shade");
    expect(migrateTreeToV2({ sunSpec: "" }).sunSpec).toBe("unknown");
  });

  it("maps legacy free-text water to the closed enum", () => {
    expect(migrateTreeToV2({ waterSpec: "abundante" }).waterSpec).toBe("very-high");
    expect(migrateTreeToV2({ waterSpec: "poco" }).waterSpec).toBe("low");
  });

  it("preserves unrecognised observed text as notes instead of losing it", () => {
    const t = migrateTreeToV2({ observedSun: "algo muy raro" });
    expect(t.observedSun).toBe("unknown");
    expect(t.observedSunNotes).toBe("algo muy raro");
  });

  it("backfills v2 fields that are absent on a v1 record", () => {
    const t = migrateTreeToV2({});
    expect(t.deciduous).toBe("unknown");
    expect(t.soilPhSpec).toBe("unknown");
    expect(t.chillHoursSpec).toBeNull();
    expect(t.matureHeightM).toBeNull();
  });
});
