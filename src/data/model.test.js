// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  blankTree,
  duplicateTree,
  estimatedAgeMonths,
  migrateTreeToV2,
} from "./model.js";

// Pure domain-model behaviour, storage-independent.

afterEach(() => {
  vi.useRealTimers();
});

describe("estimatedAgeMonths", () => {
  it("returns null when purchase date or claimed age is missing", () => {
    expect(
      estimatedAgeMonths({ purchaseDate: "", claimedAgeMonthsAtPurchase: 12 })
    ).toBeNull();
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
    expect(t.chillHoursMinSpec).toBeNull();
    expect(t.chillHoursMaxSpec).toBeNull();
    expect(t.matureHeightM).toBeNull();
  });

  it("maps a legacy single chill-hours value into the range minimum", () => {
    const t = migrateTreeToV2({ chillHoursSpec: 600 });
    expect(t.chillHoursMinSpec).toBe(600);
    expect(t.chillHoursMaxSpec).toBeNull();
    expect(t.chillHoursSpec).toBeUndefined();
  });
});

describe("duplicateTree", () => {
  const source = () => ({
    ...blankTree(),
    id: "tree:source",
    _rev: "7-abc",
    label: "07",
    commonName: "Lemon",
    otherNames: ["Limonero"],
    scientificName: "Citrus × limon",
    variety: "Eureka",
    source: "Vivero Norte",
    purchaseDate: "2024-03-01",
    claimedAgeMonthsAtPurchase: 24,
    price: 30,
    potLiters: 40,
    substrate: "peat mix",
    grafted: true,
    rootstock: "trifoliata",
    referenceNotes: "Subtropical evergreen.",
    sunSpec: "full-sun",
    waterSpec: "moderate",
    minTempC: -2,
    maxTempC: 38,
    chillHoursRequired: "no",
    deciduous: "evergreen",
    soilPhSpec: "slightly-acidic",
    growthRate: "medium",
    windTolerance: "low",
    fertilizerType: "citrus-blend",
    fertilizerNotes: "monthly in season",
    pruningTiming: "after-fruit",
    pruningNotes: "light",
    pollination: "self",
    pollinationPartnerId: "tree:other",
    fruitingSeason: "winter",
    observedSun: "part-shade",
    observedSunNotes: "scorched in January",
    observedWater: "high",
    observedWaterNotes: "dries fast",
    quirks: "drops leaves when moved",
    positionOnTerrace: "North terrace", // retired field still stored on old trees
    somethingUnknown: "from an old backup",
    careSchedule: [
      {
        task: "Water",
        intervalDays: 3,
        intervalDaysSummer: 1,
        intervalDaysWinter: 7,
        lastDone: "2026-11-01",
        extra: "x",
      },
    ],
    createdAt: "2024-03-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  });

  it("copies the names and the whole spec side", () => {
    const copy = duplicateTree(source());
    expect(copy).toMatchObject({
      commonName: "Lemon",
      otherNames: ["Limonero"],
      scientificName: "Citrus × limon",
      variety: "Eureka",
      referenceNotes: "Subtropical evergreen.",
      sunSpec: "full-sun",
      waterSpec: "moderate",
      minTempC: -2,
      maxTempC: 38,
      chillHoursRequired: "no",
      deciduous: "evergreen",
      soilPhSpec: "slightly-acidic",
      growthRate: "medium",
      windTolerance: "low",
      fertilizerType: "citrus-blend",
      fertilizerNotes: "monthly in season",
      pruningTiming: "after-fruit",
      pruningNotes: "light",
      pollination: "self",
      fruitingSeason: "winter",
    });
  });

  it("leaves blank everything that belongs to the source plant", () => {
    const copy = duplicateTree(source());
    const blank = blankTree();
    for (const key of [
      "label",
      "source",
      "purchaseDate",
      "claimedAgeMonthsAtPurchase",
      "price",
      "potLiters",
      "substrate",
      "grafted",
      "rootstock",
      "pollinationPartnerId",
      "observedSun",
      "observedSunNotes",
      "observedWater",
      "observedWaterNotes",
      "quirks",
    ]) {
      expect(copy[key], key).toEqual(blank[key]);
    }
  });

  it("is a new tree: no id, no revision, no retired or unknown fields, fresh dates", () => {
    const copy = duplicateTree(source());
    for (const key of ["id", "_id", "_rev", "positionOnTerrace", "somethingUnknown"]) {
      expect(copy, key).not.toHaveProperty(key);
    }
    expect(copy.createdAt).not.toBe("2024-03-01T00:00:00.000Z");
    expect(Object.keys(copy).sort()).toEqual(Object.keys(blankTree()).sort());
  });

  it("copies the care routine as never done, with only the known fields", () => {
    const copy = duplicateTree(source());
    expect(copy.careSchedule).toEqual([
      {
        task: "Water",
        intervalDays: 3,
        intervalDaysSummer: 1,
        intervalDaysWinter: 7,
        lastDone: null,
      },
    ]);
  });

  it("shares no arrays or task objects with the source", () => {
    const original = source();
    const copy = duplicateTree(original);
    copy.otherNames.push("Citron");
    copy.careSchedule[0].task = "Changed";
    expect(original.otherNames).toEqual(["Limonero"]);
    expect(original.careSchedule[0].task).toBe("Water");
  });

  it("turns an incomplete or malformed care routine into well-formed tasks", () => {
    const copy = duplicateTree({
      commonName: "Fig",
      otherNames: "nope",
      careSchedule: [
        null,
        "water",
        ["x"],
        { task: "Water" }, // no interval stored
        { task: 5, intervalDays: "3", intervalDaysSummer: 0, intervalDaysWinter: -1 },
        { task: "Feed", intervalDays: 30, intervalDaysSummer: 15 },
      ],
    });
    expect(copy.commonName).toBe("Fig");
    expect(copy.otherNames).toEqual([]);
    const task = (name, days, summer = null) => ({
      task: name,
      intervalDays: days,
      intervalDaysSummer: summer,
      intervalDaysWinter: null,
      lastDone: null,
    });
    expect(copy.careSchedule).toEqual([
      task("Water", 7),
      task("", 7),
      task("Feed", 30, 15),
    ]);
  });
});
