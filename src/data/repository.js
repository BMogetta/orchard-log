import { pouch, uid, allOfType, blobToBase64, base64ToBlob } from "./backend.js";

// The repository is the ONLY data-access surface the UI and domain helpers use.
// It maps between the app's records ({ id, ...fields }) and PouchDB docs
// ({ _id, _rev, ...fields }), so callers never see _id/_rev/attachments.
// Backend-level exceptions that do bulk work instead of per-record access:
// `lib/backup.js` (export/import) and `lib/demo.js` (seed/reset).
//
// At this scale (dozens of trees, hundreds of events) filtering/sorting in
// memory over a prefix range is simpler and cheaper than secondary indexes.

const toApp = (doc) => {
  const { _id, _rev, ...rest } = doc;
  return { ...rest, id: _id, _rev };
};

const byDateAsc = (a, b) => (a.date || "").localeCompare(b.date || "");
const byDateDesc = (a, b) => (b.date || "").localeCompare(a.date || "");

export const trees = {
  all: async () => (await allOfType("tree")).map(toApp),

  allByLabel: async () =>
    (await allOfType("tree"))
      .map(toApp)
      .sort((a, b) => (a.label || "").localeCompare(b.label || "")),

  get: async (id) => {
    try {
      return toApp(await pouch.get(id));
    } catch (e) {
      if (e.status === 404) return undefined;
      throw e;
    }
  },

  save: async (tree) => {
    const now = new Date().toISOString();
    const { id, _rev, ...rest } = tree;
    if (id == null) {
      const _id = `tree:${uid()}`;
      await pouch.put({ _id, ...rest, createdAt: now, updatedAt: now });
      return _id;
    }
    await pouch.put({ _id: id, _rev, ...rest, updatedAt: now });
    return id;
  },

  // Cascade: drop the tree and all of its events + photos.
  remove: async (id) => {
    const dead = [];
    const tree = await pouch.get(id).catch(() => null);
    if (tree) dead.push({ _id: tree._id, _rev: tree._rev, _deleted: true });
    for (const prefix of ["event", "photo"]) {
      for (const d of await allOfType(prefix)) {
        if (d.treeId === id) dead.push({ _id: d._id, _rev: d._rev, _deleted: true });
      }
    }
    if (dead.length) await pouch.bulkDocs(dead);
  },
};

export const events = {
  // Newest first — the timeline order.
  forTree: async (treeId) =>
    (await allOfType("event"))
      .map(toApp)
      .filter((e) => e.treeId === treeId)
      .sort(byDateDesc),

  // Oldest first — callers that want the latest of a kind take .at(-1).
  forTreeOfType: async (treeId, type) =>
    (await allOfType("event"))
      .map(toApp)
      .filter((e) => e.treeId === treeId && e.type === type)
      .sort(byDateAsc),

  add: async (event) => {
    const _id = `event:${uid()}`;
    await pouch.put({
      date: new Date().toISOString().slice(0, 10),
      type: "note",
      notes: "",
      ...event,
      _id,
    });
    return _id;
  },

  // Update an existing event (object carries id + _rev from a prior read).
  update: async (event) => {
    const { id, _rev, ...rest } = event;
    await pouch.put({ _id: id, _rev, ...rest });
    return id;
  },

  remove: async (id) => {
    const doc = await pouch.get(id);
    await pouch.remove(doc);
  },
};

export const photos = {
  forTree: async (treeId) => {
    const docs = await allOfType("photo", { attachments: true });
    return docs
      .filter((d) => d.treeId === treeId)
      .map((d) => ({
        id: d._id,
        treeId: d.treeId,
        eventId: d.eventId ?? null,
        createdAt: d.createdAt,
        blob: base64ToBlob(d._attachments?.image?.data, d._attachments?.image?.content_type),
      }));
  },

  add: async ({ treeId, eventId = null, blob }) => {
    const _id = `photo:${uid()}`;
    const data = await blobToBase64(blob);
    await pouch.put({
      _id,
      treeId,
      eventId,
      createdAt: new Date().toISOString(),
      _attachments: { image: { content_type: blob.type || "image/jpeg", data } },
    });
    return _id;
  },
};
