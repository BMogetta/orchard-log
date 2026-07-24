// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDatabase } from "../data/backend.js";
import { blankTree } from "../data/model.js";
import { trees, events, photos } from "../data/repository.js";
import { exportBackup, importBackup } from "./backup.js";

// Backup is the ONLY safety net for local data, so its round-trip and guards
// are characterized, including that v1/v2 (Dexie-era) backups still import.
// Node env: complete Blob + the PouchDB memory adapter.

let capturedBlob;

beforeEach(async () => {
  await resetDatabase();
  capturedBlob = null;
  global.URL.createObjectURL = vi.fn((blob) => {
    capturedBlob = blob;
    return "blob:mock";
  });
  global.URL.revokeObjectURL = vi.fn();
  // exportBackup builds an <a> and clicks it to trigger the download.
  global.document = { createElement: () => ({ href: "", download: "", click() {} }) };
});

afterEach(() => {
  delete global.document;
  vi.restoreAllMocks();
});

const fileOf = (obj) => ({ text: async () => JSON.stringify(obj) });
const dumpFrom = async () => JSON.parse(Buffer.from(await capturedBlob.arrayBuffer()).toString("utf8"));

describe("exportBackup", () => {
  it("dumps typed docs, photos as base64 attachments, no _local/_rev", async () => {
    const treeId = await trees.save({ ...blankTree(), commonName: "Quince" });
    await events.add({ treeId, type: "note", notes: "hello" });
    await photos.add({ treeId, blob: new Blob(["img"], { type: "image/jpeg" }) });

    await exportBackup();
    const dump = await dumpFrom();

    expect(dump.app).toBe("orchard-log");
    expect(dump.version).toBe(3);
    expect(dump.docs.some((d) => d._id.startsWith("tree:"))).toBe(true);
    expect(dump.docs.some((d) => d._id.startsWith("event:"))).toBe(true);
    const photo = dump.docs.find((d) => d._id.startsWith("photo:"));
    expect(photo._attachments.image.data).toBeTruthy();
    expect(dump.docs.every((d) => !d._id.startsWith("_") && d._rev === undefined)).toBe(true);
  });
});

describe("importBackup — v3 round-trip", () => {
  it("restores exported data, rehydrating photos to Blobs", async () => {
    const treeId = await trees.save({ ...blankTree(), commonName: "Quince" });
    await photos.add({ treeId, blob: new Blob(["img"], { type: "image/jpeg" }) });
    await exportBackup();
    const dump = await dumpFrom();

    await importBackup(fileOf(dump), { replace: true });

    const all = await trees.all();
    expect(all).toHaveLength(1);
    const [p] = await photos.forTree(all[0].id);
    expect(p.blob).toBeInstanceOf(Blob);
    expect(await new Response(p.blob).text()).toBe("img");
  });
});

describe("importBackup — legacy Dexie backups", () => {
  it("migrates a v1 tree (free-text sun) into a v3 doc", async () => {
    const v1 = {
      app: "orchard-log",
      version: 1,
      trees: [{ id: 1, commonName: "Peach", sunSpec: "full sun" }],
      events: [],
      photos: [],
    };
    await importBackup(fileOf(v1), { replace: true });
    const all = await trees.all();
    expect(all).toHaveLength(1);
    expect(all[0].id).toMatch(/^tree:/);
    expect(all[0].sunSpec).toBe("full-sun");
  });

  it("restores a v2 photo stored as a data URL", async () => {
    const v2 = {
      app: "orchard-log",
      version: 2,
      trees: [{ id: 1, commonName: "Lemon" }],
      events: [{ id: 5, treeId: 1, type: "note", date: "2024-01-01" }],
      photos: [
        { id: 9, treeId: 1, eventId: 5, createdAt: "2024-01-01T00:00:00Z", blob: `data:image/jpeg;base64,${btoa("img")}` },
      ],
    };
    await importBackup(fileOf(v2), { replace: true });
    const [tree] = await trees.all();
    const [p] = await photos.forTree(tree.id);
    expect(await new Response(p.blob).text()).toBe("img");
  });
});

describe("importBackup — guards", () => {
  it("rejects a file that is not an Orchard Log backup", async () => {
    await expect(importBackup(fileOf({ app: "something-else" }))).rejects.toThrow(
      "backup.invalidFile"
    );
  });

  it("rejects invalid JSON", async () => {
    await expect(importBackup({ text: async () => "not json" })).rejects.toThrow(
      "backup.invalidFile"
    );
  });

  it("rejects a v3 backup whose docs are not an array", async () => {
    await expect(
      importBackup(fileOf({ app: "orchard-log", version: 3, docs: "nope" }))
    ).rejects.toThrow("backup.invalidStructure");
  });
});
