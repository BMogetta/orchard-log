// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./backend.js";
import { trees, events, photos } from "./repository.js";
import { migrateFromDexie } from "./migrate.js";

// Seed a legacy Dexie-shaped IndexedDB ("orchard-log", integer ids) using the
// raw IndexedDB API (fake-indexeddb under node), then let migrateFromDexie
// carry it into PouchDB with UUID ids and remapped references.

function seedLegacy({ trees: ts, events: es, photos: ps }) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("orchard-log", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ["trees", "events", "photos"]) {
        db.createObjectStore(name, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(["trees", "events", "photos"], "readwrite");
      ts.forEach((t) => tx.objectStore("trees").put(t));
      es.forEach((e) => tx.objectStore("events").put(e));
      ps.forEach((p) => tx.objectStore("photos").put(p));
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("migrateFromDexie", () => {
  it("moves trees, events and photos to PouchDB, remapping ids and refs", async () => {
    await seedLegacy({
      trees: [
        { id: 1, commonName: "Lemon", pollination: "needs-partner", pollinationPartnerId: 2 },
        { id: 2, commonName: "Lime" },
      ],
      events: [{ id: 5, treeId: 1, type: "repot", date: "2024-01-01", notes: "40L" }],
      photos: [
        { id: 9, treeId: 1, eventId: 5, createdAt: "2024-01-01T00:00:00Z", blob: new Blob(["img"], { type: "image/jpeg" }) },
      ],
    });

    const result = await migrateFromDexie();
    expect(result).toMatchObject({ migrated: true, trees: 2 });

    const all = await trees.all();
    expect(all).toHaveLength(2);
    const lemon = all.find((t) => t.commonName === "Lemon");
    const lime = all.find((t) => t.commonName === "Lime");

    // partner reference remapped to the new UUID id
    expect(lemon.pollinationPartnerId).toBe(lime.id);

    // event carried over and re-linked to the new tree id
    const evs = await events.forTree(lemon.id);
    expect(evs).toHaveLength(1);
    expect(evs[0].type).toBe("repot");

    // photo re-linked to the new tree + event ids, blob intact
    const ps = await photos.forTree(lemon.id);
    expect(ps).toHaveLength(1);
    expect(ps[0].eventId).toBe(evs[0].id);
    expect(await new Response(ps[0].blob).text()).toBe("img");
  });

  it("is idempotent — a second run does nothing", async () => {
    const again = await migrateFromDexie();
    expect(again.migrated).toBe(false);
  });
});
