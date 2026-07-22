import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db.js";
import { blankTree } from "./index.js";
import { trees, events, photos } from "./repository.js";

// The repository is the seam the whole UI depends on; these lock its shape and
// ordering so the Phase 2 PouchDB backend can be validated against the same API.

beforeEach(async () => {
  await Promise.all([db.trees.clear(), db.events.clear(), db.photos.clear()]);
});

describe("trees repo", () => {
  it("saves and reads back a tree", async () => {
    const id = await trees.save({ ...blankTree(), commonName: "Fig" });
    expect((await trees.get(id)).commonName).toBe("Fig");
  });

  it("allByLabel returns trees ordered by pot label", async () => {
    await trees.save({ ...blankTree(), label: "03" });
    await trees.save({ ...blankTree(), label: "01" });
    await trees.save({ ...blankTree(), label: "02" });
    expect((await trees.allByLabel()).map((t) => t.label)).toEqual(["01", "02", "03"]);
  });

  it("remove cascades to the tree's events and photos", async () => {
    const id = await trees.save(blankTree());
    await events.add({ treeId: id });
    await photos.add({ treeId: id, blob: new Blob(["x"]) });
    await trees.remove(id);
    expect(await trees.get(id)).toBeUndefined();
    expect(await events.forTree(id)).toHaveLength(0);
    expect(await photos.forTree(id)).toHaveLength(0);
  });
});

describe("events repo", () => {
  it("forTree returns newest first", async () => {
    const id = await trees.save(blankTree());
    await events.add({ treeId: id, date: "2024-01-01", notes: "old" });
    await events.add({ treeId: id, date: "2024-06-01", notes: "new" });
    expect((await events.forTree(id)).map((e) => e.notes)).toEqual(["new", "old"]);
  });

  it("forTreeOfType filters by type, oldest first", async () => {
    const id = await trees.save(blankTree());
    await events.add({ treeId: id, type: "note", date: "2024-01-01" });
    await events.add({ treeId: id, type: "repot", date: "2024-02-01" });
    await events.add({ treeId: id, type: "repot", date: "2024-05-01" });
    const repots = await events.forTreeOfType(id, "repot");
    expect(repots.map((e) => e.date)).toEqual(["2024-02-01", "2024-05-01"]);
  });
});
