// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./backend.js";
import { blankTree } from "./model.js";
import { trees, events, photos } from "./repository.js";

// The repository is the seam the whole UI depends on. These lock its API shape,
// id handling, ordering, and photo-attachment round-trip against the PouchDB
// backend (in-memory adapter under test).

beforeEach(async () => {
  await resetDatabase();
});

describe("trees repo", () => {
  it("save assigns a prefixed uuid id and stamps timestamps", async () => {
    const id = await trees.save(blankTree());
    expect(id).toMatch(/^tree:/);
    const stored = await trees.get(id);
    expect(stored.id).toBe(id);
    expect(stored.createdAt).toBeTruthy();
    expect(stored.updatedAt).toBeTruthy();
  });

  it("save updates an existing tree in place (carrying _rev)", async () => {
    const id = await trees.save({ ...blankTree(), commonName: "Fig" });
    const loaded = await trees.get(id);
    await trees.save({ ...loaded, commonName: "Lemon" });
    const again = await trees.get(id);
    expect(again.id).toBe(id);
    expect(again.commonName).toBe("Lemon");
  });

  it("get returns undefined for a missing id", async () => {
    expect(await trees.get("tree:nope")).toBeUndefined();
  });

  it("allByLabel returns trees ordered by pot label", async () => {
    await trees.save({ ...blankTree(), label: "03" });
    await trees.save({ ...blankTree(), label: "01" });
    await trees.save({ ...blankTree(), label: "02" });
    expect((await trees.allByLabel()).map((t) => t.label)).toEqual(["01", "02", "03"]);
  });

  it("remove cascades to the tree's events and photos, leaving others", async () => {
    const keep = await trees.save(blankTree());
    const drop = await trees.save(blankTree());
    await events.add({ treeId: keep });
    await events.add({ treeId: drop });
    await photos.add({ treeId: keep, blob: new Blob(["a"]) });
    await photos.add({ treeId: drop, blob: new Blob(["b"]) });

    await trees.remove(drop);

    expect(await trees.get(drop)).toBeUndefined();
    expect(await events.forTree(drop)).toHaveLength(0);
    expect(await photos.forTree(drop)).toHaveLength(0);
    expect(await trees.get(keep)).toBeDefined();
    expect(await events.forTree(keep)).toHaveLength(1);
    expect(await photos.forTree(keep)).toHaveLength(1);
  });
});

describe("events repo", () => {
  it("add applies defaults for date, type and notes", async () => {
    const treeId = await trees.save(blankTree());
    await events.add({ treeId });
    const [ev] = await events.forTree(treeId);
    expect(ev.type).toBe("note");
    expect(ev.notes).toBe("");
    expect(ev.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("forTree returns newest first", async () => {
    const treeId = await trees.save(blankTree());
    await events.add({ treeId, date: "2024-01-01", notes: "old" });
    await events.add({ treeId, date: "2024-06-01", notes: "new" });
    expect((await events.forTree(treeId)).map((e) => e.notes)).toEqual(["new", "old"]);
  });

  it("forTreeOfType filters by kind, oldest first", async () => {
    const treeId = await trees.save(blankTree());
    await events.add({ treeId, type: "note", date: "2024-01-01" });
    await events.add({ treeId, type: "repot", date: "2024-02-01" });
    await events.add({ treeId, type: "repot", date: "2024-05-01" });
    const repots = await events.forTreeOfType(treeId, "repot");
    expect(repots.map((e) => e.date)).toEqual(["2024-02-01", "2024-05-01"]);
  });

  it("update edits an existing event in place", async () => {
    const treeId = await trees.save(blankTree());
    await events.add({ treeId, type: "note", notes: "typo", date: "2024-01-01" });
    const [ev] = await events.forTree(treeId);
    await events.update({ ...ev, notes: "fixed", type: "prune" });
    const [after] = await events.forTree(treeId);
    expect(after.id).toBe(ev.id);
    expect(after.notes).toBe("fixed");
    expect(after.type).toBe("prune");
  });

  it("remove deletes a single event, leaving the rest", async () => {
    const treeId = await trees.save(blankTree());
    await events.add({ treeId, notes: "keep", date: "2024-01-01" });
    await events.add({ treeId, notes: "drop", date: "2024-02-01" });
    const drop = (await events.forTree(treeId)).find((e) => e.notes === "drop");
    await events.remove(drop.id);
    const left = await events.forTree(treeId);
    expect(left).toHaveLength(1);
    expect(left[0].notes).toBe("keep");
  });
});

describe("photos repo", () => {
  it("stores a photo and reads its blob back", async () => {
    const treeId = await trees.save(blankTree());
    await photos.add({ treeId, blob: new Blob(["img"], { type: "image/jpeg" }) });
    const [p] = await photos.forTree(treeId);
    expect(p.treeId).toBe(treeId);
    expect(p.blob).toBeInstanceOf(Blob);
    expect(await new Response(p.blob).text()).toBe("img");
  });

  it("attaches a photo to a specific event", async () => {
    const treeId = await trees.save(blankTree());
    const eventId = await events.add({ treeId, type: "note" });
    await photos.add({ treeId, eventId, blob: new Blob(["x"]) });
    const [p] = await photos.forTree(treeId);
    expect(p.eventId).toBe(eventId);
  });

  it("remove deletes a single photo", async () => {
    const treeId = await trees.save(blankTree());
    await photos.add({ treeId, blob: new Blob(["a"]) });
    const [p] = await photos.forTree(treeId);
    await photos.remove(p.id);
    expect(await photos.forTree(treeId)).toHaveLength(0);
  });
});
