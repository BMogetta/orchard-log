import { pouch, uid, blobToBase64 } from "./backend.js";
import { migrateTreeToV2 } from "./model.js";

// One-time, non-destructive migration of the legacy Dexie database
// ("orchard-log", integer auto-increment ids) into the PouchDB backend
// (UUID-prefixed docs, photos as attachments). The old Dexie DB is left intact
// as a fallback; a _local flag marks completion so this runs at most once.

const FLAG = "_local/migrated-from-dexie";

// Read the legacy Dexie stores with the raw IndexedDB API, so this file carries
// no dependency on Dexie (which the app no longer bundles). Returns null when
// there is nothing to migrate.
function readLegacy() {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open("orchard-log");
    } catch {
      return resolve(null);
    }
    // Fired only if the DB didn't exist — nothing to migrate.
    req.onupgradeneeded = () => {};
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const idb = req.result;
      const names = ["trees", "events", "photos"];
      if (!names.every((n) => idb.objectStoreNames.contains(n))) {
        idb.close();
        return resolve(null);
      }
      const tx = idb.transaction(names, "readonly");
      const getAll = (n) =>
        new Promise((res, rej) => {
          const r = tx.objectStore(n).getAll();
          r.onsuccess = () => res(r.result || []);
          r.onerror = () => rej(r.error);
        });
      Promise.all(names.map(getAll))
        .then(([trees, events, photos]) => {
          idb.close();
          resolve({ trees, events, photos });
        })
        .catch(() => {
          idb.close();
          resolve(null);
        });
    };
  });
}

export async function migrateFromDexie() {
  const already = await pouch.get(FLAG).catch(() => null);
  if (already) return { migrated: false, reason: "already-done" };

  const legacy = await readLegacy();
  if (!legacy || legacy.trees.length === 0) {
    await pouch.put({ _id: FLAG, at: new Date().toISOString(), count: 0 });
    return { migrated: false, reason: "no-legacy-data" };
  }

  const treeIdMap = new Map(); // legacy int id -> "tree:<uuid>"
  const eventIdMap = new Map(); // legacy int id -> "event:<uuid>"
  const docs = [];

  for (const t of legacy.trees) {
    const { id, ...rest } = migrateTreeToV2({ ...t });
    const _id = `tree:${uid()}`;
    treeIdMap.set(id, _id);
    docs.push({ _id, ...rest });
  }
  // Remap pollination partner references to the new tree ids (drop danglers).
  for (const d of docs) {
    if (d.pollinationPartnerId != null) {
      d.pollinationPartnerId = treeIdMap.get(d.pollinationPartnerId) ?? null;
    }
  }

  for (const e of legacy.events) {
    const { id, treeId, ...rest } = e;
    const newTree = treeIdMap.get(treeId);
    if (!newTree) continue; // orphaned event
    const _id = `event:${uid()}`;
    eventIdMap.set(id, _id);
    docs.push({ _id, treeId: newTree, ...rest });
  }

  const photoDocs = [];
  for (const p of legacy.photos) {
    const newTree = treeIdMap.get(p.treeId);
    if (!newTree || !p.blob) continue;
    photoDocs.push({
      _id: `photo:${uid()}`,
      treeId: newTree,
      eventId: p.eventId != null ? (eventIdMap.get(p.eventId) ?? null) : null,
      createdAt: p.createdAt,
      _attachments: {
        image: { content_type: p.blob.type || "image/jpeg", data: await blobToBase64(p.blob) },
      },
    });
  }

  await pouch.bulkDocs([...docs, ...photoDocs]);
  await pouch.put({ _id: FLAG, at: new Date().toISOString(), count: legacy.trees.length });
  return { migrated: true, trees: legacy.trees.length };
}
