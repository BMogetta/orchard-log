import { db, migrateTreeToV2 } from "../db.js";

// ---------------------------------------------------------------------------
// Local data can vanish (cleared browser, lost phone). Export early, export
// often. This dumps EVERYTHING — trees, events, and photo blobs (base64) —
// into one portable JSON file, and can restore from it.
//
// Backup format versions:
//   1 — original free-text spec fields (sunSpec, waterSpec, pruningSpec, ...)
//   2 — spec fields become closed enums; pruning/fertilizer split into
//       type + notes; adds chillHoursSpec, deciduous, matureHeight/Spread,
//       soilPhSpec, growthRate, windTolerance; careSchedule tasks gain
//       intervalDaysSummer / intervalDaysWinter.
// Older backups are migrated on import via migrateTreeToV2.
// ---------------------------------------------------------------------------

const BACKUP_VERSION = 2;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function exportBackup() {
  const [trees, events, photos] = await Promise.all([
    db.trees.toArray(),
    db.events.toArray(),
    db.photos.toArray(),
  ]);

  const photosEncoded = await Promise.all(
    photos.map(async (p) => ({
      ...p,
      blob: await blobToDataUrl(p.blob),
    }))
  );

  const backup = {
    app: "orchard-log",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    trees,
    events,
    photos: photosEncoded,
  };

  const blob = new Blob([JSON.stringify(backup)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orchard-log-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// replace=true wipes current data first. Otherwise records are written by
// their EXISTING id (bulkPut): if the imported ids overlap the current DB, the
// matching records are overwritten, not merged. Auto-increment ids collide
// across devices, so a real id-remapping merge is still a TODO — see the
// project notes on shared/multi-device use before relying on merge.
export async function importBackup(file, { replace = false } = {}) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("backup.invalidFile");
  }
  if (!data || data.app !== "orchard-log") {
    // Message is an i18n key; the UI translates it before display.
    throw new Error("backup.invalidFile");
  }
  // A file can carry the right marker but a broken shape. Reject anything whose
  // record collections aren't arrays before we start writing to IndexedDB.
  // (Missing keys are tolerated — older/partial backups may omit an empty one.)
  const isArrayOrMissing = (v) => v == null || Array.isArray(v);
  if (
    !isArrayOrMissing(data.trees) ||
    !isArrayOrMissing(data.events) ||
    !isArrayOrMissing(data.photos)
  ) {
    throw new Error("backup.invalidStructure");
  }

  // Dexie's version.upgrade() only runs on live IndexedDB, not on records we
  // bulk-put from a JSON file. Apply the same migration here so v1 backups
  // land as v2 records.
  const fileVersion = data.version ?? 1;
  const treesToPut = (data.trees || []).map((t) =>
    fileVersion < 2 ? migrateTreeToV2({ ...t }) : t
  );

  await db.transaction("rw", db.trees, db.events, db.photos, async () => {
    if (replace) {
      await Promise.all([db.trees.clear(), db.events.clear(), db.photos.clear()]);
    }
    await db.trees.bulkPut(treesToPut);
    await db.events.bulkPut(data.events || []);
    for (const p of data.photos || []) {
      await db.photos.put({ ...p, blob: await dataUrlToBlob(p.blob) });
    }
  });
}
