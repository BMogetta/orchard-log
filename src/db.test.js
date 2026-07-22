import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  db,
  blankTree,
  saveTree,
  addEvent,
  addPhoto,
  deleteTree,
  estimatedAgeMonths,
  migrateTreeToV2,
} from "./db.js";

// These tests freeze the CURRENT behaviour of db.js before the PouchDB
// migration, so the migration can't silently regress it.

beforeEach(async () => {
  await Promise.all([db.trees.clear(), db.events.clear(), db.photos.clear()]);
});

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
    // 365 days after purchase ≈ 11.99 months -> rounds to 12.
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

describe("write helpers", () => {
  it("saveTree assigns an id and stamps timestamps on create", async () => {
    const id = await saveTree(blankTree());
    const stored = await db.trees.get(id);
    expect(stored.id).toBe(id);
    expect(stored.createdAt).toBeTruthy();
    expect(stored.updatedAt).toBeTruthy();
  });

  it("saveTree refreshes updatedAt on update", async () => {
    const id = await saveTree(blankTree());
    const first = await db.trees.get(id);
    await new Promise((r) => setTimeout(r, 2));
    await saveTree({ ...first, commonName: "Lemon" });
    const second = await db.trees.get(id);
    expect(second.commonName).toBe("Lemon");
    expect(second.updatedAt >= first.updatedAt).toBe(true);
  });

  it("addEvent applies defaults for date, type and notes", async () => {
    const id = await addEvent({ treeId: 1 });
    const ev = await db.events.get(id);
    expect(ev.type).toBe("note");
    expect(ev.notes).toBe("");
    expect(ev.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("deleteTree cascades to that tree's events and photos only", async () => {
    const keep = await saveTree(blankTree());
    const drop = await saveTree(blankTree());
    await addEvent({ treeId: keep });
    await addEvent({ treeId: drop });
    await addPhoto({ treeId: keep, blob: new Blob(["a"]) });
    await addPhoto({ treeId: drop, blob: new Blob(["b"]) });

    await deleteTree(drop);

    expect(await db.trees.get(drop)).toBeUndefined();
    expect(await db.events.where("treeId").equals(drop).count()).toBe(0);
    expect(await db.photos.where("treeId").equals(drop).count()).toBe(0);
    // The other tree is untouched.
    expect(await db.trees.get(keep)).toBeDefined();
    expect(await db.events.where("treeId").equals(keep).count()).toBe(1);
    expect(await db.photos.where("treeId").equals(keep).count()).toBe(1);
  });
});
