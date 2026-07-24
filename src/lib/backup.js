import { pouch, uid, resetDatabase } from "../data/backend.js";
import { migrateTreeToV2 } from "../data/model.js";

// ---------------------------------------------------------------------------
// Local data can vanish (cleared browser, lost phone). Export early, export
// often. This dumps EVERYTHING to one portable JSON file and restores from it.
//
// Backup format versions:
//   1 — Dexie era: free-text spec fields, integer ids, photos as base64 blobs.
//   2 — Dexie era: closed enums, split pruning/fertilizer, seasonal intervals.
//   3 — PouchDB era: raw docs (UUID `_id`, photos as base64 attachments).
// v1/v2 backups are transformed on import into v3 docs (new UUID ids), so old
// backups stay loadable.
// ---------------------------------------------------------------------------

const BACKUP_VERSION = 3;

export async function exportBackup() {
  const res = await pouch.allDocs({ include_docs: true, attachments: true });
  const docs = res.rows
    .map((r) => r.doc)
    .filter((d) => !d._id.startsWith("_")) // skip _local/* (migration flag etc.)
    .map(({ _rev, ...doc }) => doc); // fresh revs on restore

  const backup = {
    app: "orchard-log",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    docs,
  };

  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orchard-log-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// replace=true wipes current data first; otherwise it merges. Merge is safe now
// that ids are UUIDs — two devices' exports don't collide.
export async function importBackup(file, { replace = false } = {}) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("backup.invalidFile");
  }
  if (!data || data.app !== "orchard-log") {
    throw new Error("backup.invalidFile");
  }

  const version = data.version ?? 1;
  let docs;
  if (version >= 3) {
    if (!Array.isArray(data.docs)) throw new Error("backup.invalidStructure");
    docs = data.docs.map(({ _rev, ...d }) => d);
  } else {
    const isArrayOrNil = (v) => v == null || Array.isArray(v);
    if (![data.trees, data.events, data.photos].every(isArrayOrNil)) {
      throw new Error("backup.invalidStructure");
    }
    docs = legacyArraysToDocs(data, version);
  }

  if (replace) await resetDatabase();
  await pouch.bulkDocs(docs);
}

// Transform a v1/v2 Dexie-shaped backup ({trees,events,photos} with integer
// ids and data-URL photos) into v3 PouchDB docs, remapping ids to UUIDs.
function legacyArraysToDocs(data, version) {
  const treeIdMap = new Map();
  const eventIdMap = new Map();
  const out = [];

  for (const t of data.trees || []) {
    const src = version < 2 ? migrateTreeToV2({ ...t }) : { ...t };
    const { id, ...rest } = src;
    const _id = `tree:${uid()}`;
    treeIdMap.set(id, _id);
    out.push({ _id, ...rest });
  }
  for (const d of out) {
    if (d.pollinationPartnerId != null) {
      d.pollinationPartnerId = treeIdMap.get(d.pollinationPartnerId) ?? null;
    }
  }

  for (const e of data.events || []) {
    const { id, treeId, ...rest } = e;
    const newTree = treeIdMap.get(treeId);
    if (!newTree) continue;
    const _id = `event:${uid()}`;
    eventIdMap.set(id, _id);
    out.push({ _id, treeId: newTree, ...rest });
  }

  for (const p of data.photos || []) {
    const newTree = treeIdMap.get(p.treeId);
    if (!newTree || !p.blob) continue;
    // photo blob is a data URL: data:<content-type>;base64,<data>
    const [meta, b64] = String(p.blob).split(",");
    const contentType = /data:(.*?);/.exec(meta)?.[1] || "image/jpeg";
    out.push({
      _id: `photo:${uid()}`,
      treeId: newTree,
      eventId: p.eventId != null ? (eventIdMap.get(p.eventId) ?? null) : null,
      createdAt: p.createdAt,
      _attachments: { image: { content_type: contentType, data: b64 } },
    });
  }

  return out;
}
