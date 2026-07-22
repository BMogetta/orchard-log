// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db, saveTree, blankTree, addEvent, addPhoto } from "../db.js";
import { exportBackup, importBackup } from "./backup.js";

// Backup is the ONLY safety net for local data, so its round-trip and its
// guards are characterized before the migration touches the format.
//
// Runs in the NODE environment on purpose: jsdom's Blob is a minimal stub
// without arrayBuffer/text, whereas Node's Blob is complete and round-trips
// cleanly through fake-indexeddb. exportBackup reaches for a few browser APIs
// (document, URL object URLs, FileReader) that node lacks, so we stub exactly
// those — protecting the backup *logic*, not the browser's exact wiring.

let capturedBlob;

beforeEach(async () => {
  await Promise.all([db.trees.clear(), db.events.clear(), db.photos.clear()]);
  capturedBlob = null;

  global.URL.createObjectURL = vi.fn((blob) => {
    capturedBlob = blob;
    return "blob:mock";
  });
  global.URL.revokeObjectURL = vi.fn();

  // exportBackup builds an <a> and clicks it to trigger the download.
  global.document = {
    createElement: () => ({ href: "", download: "", click() {} }),
  };

  global.FileReader = class {
    readAsDataURL(blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          const b64 = Buffer.from(buf).toString("base64");
          this.result = `data:${blob.type || "application/octet-stream"};base64,${b64}`;
          this.onload?.();
        })
        .catch((err) => this.onerror?.(err));
    }
  };
});

afterEach(() => {
  delete global.document;
  delete global.FileReader;
  vi.restoreAllMocks();
});

// Minimal stand-in for a File; importBackup only calls .text().
const fileOf = (obj) => ({ text: async () => JSON.stringify(obj) });
const blobText = async (blob) =>
  Buffer.from(await blob.arrayBuffer()).toString("utf8");

describe("exportBackup", () => {
  it("dumps trees, events and photos with photos encoded as data URLs", async () => {
    const id = await saveTree({ ...blankTree(), commonName: "Quince" });
    await addEvent({ treeId: id, type: "note", notes: "hello" });
    await addPhoto({ treeId: id, blob: new Blob(["img"], { type: "image/jpeg" }) });

    await exportBackup();

    expect(capturedBlob).toBeTruthy();
    const dump = JSON.parse(await blobText(capturedBlob));
    expect(dump.app).toBe("orchard-log");
    expect(dump.version).toBe(2);
    expect(dump.trees).toHaveLength(1);
    expect(dump.events).toHaveLength(1);
    expect(dump.photos).toHaveLength(1);
    expect(dump.photos[0].blob).toMatch(/^data:/);
  });
});

describe("importBackup — round-trip", () => {
  it("restores exported data, rehydrating photos back into Blobs", async () => {
    const id = await saveTree({ ...blankTree(), commonName: "Quince" });
    await addPhoto({ treeId: id, blob: new Blob(["img"], { type: "image/jpeg" }) });
    await exportBackup();
    const dump = JSON.parse(await blobText(capturedBlob));

    await importBackup(fileOf(dump), { replace: true });

    expect(await db.trees.count()).toBe(1);
    const photos = await db.photos.toArray();
    expect(photos).toHaveLength(1);
    expect(typeof photos[0].blob).not.toBe("string");
    expect(await blobText(photos[0].blob)).toBe("img");
  });
});

describe("importBackup — v1 migration", () => {
  it("normalises a legacy v1 tree on import", async () => {
    const v1 = {
      app: "orchard-log",
      version: 1,
      trees: [{ id: 1, commonName: "Peach", sunSpec: "full sun" }],
      events: [],
      photos: [],
    };
    await importBackup(fileOf(v1), { replace: true });
    const stored = await db.trees.get(1);
    expect(stored.sunSpec).toBe("full-sun");
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

  it("rejects a backup whose record collections are the wrong type", async () => {
    await expect(
      importBackup(fileOf({ app: "orchard-log", version: 2, trees: "nope" }))
    ).rejects.toThrow("backup.invalidStructure");
  });
});
