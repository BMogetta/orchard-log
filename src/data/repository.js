import { db, saveTree, addEvent, addPhoto, deleteTree } from "../db.js";

// The repository is the ONLY data-access surface the UI and domain helpers use.
// Nothing outside this folder (and the backend it wraps, db.js) should touch
// Dexie directly, with two sanctioned backend-level exceptions that do bulk
// dump/restore/seed rather than per-record access: `lib/backup.js` (full
// export/import) and `lib/demo.js` (seed/reset). When Phase 2 swaps the backend
// to PouchDB, only these files change — UI call sites stay put.
//
// Query methods return the same shapes the components already relied on, so the
// migration to this layer is behaviour-preserving.

export const trees = {
  all: () => db.trees.toArray(),
  allByLabel: () => db.trees.orderBy("label").toArray(),
  get: (id) => db.trees.get(id),
  save: (tree) => saveTree(tree),
  remove: (id) => deleteTree(id),
};

export const events = {
  // Newest first — the timeline order.
  forTree: (treeId) =>
    db.events.where("treeId").equals(treeId).reverse().sortBy("date"),
  // Oldest first — callers that need the latest of a kind take .at(-1).
  forTreeOfType: (treeId, type) => db.events.where({ treeId, type }).sortBy("date"),
  add: (event) => addEvent(event),
};

export const photos = {
  forTree: (treeId) => db.photos.where("treeId").equals(treeId).toArray(),
  add: (photo) => addPhoto(photo),
};
