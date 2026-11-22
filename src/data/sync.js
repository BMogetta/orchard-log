import { pouch, blobToBase64 } from "./backend.js";
import {
  canonicalBody,
  isPhotoId,
  photoPath,
  MAX_DOC_CHARS,
  MAX_DOCS_PER_PUSH,
  MAX_PHOTO_BYTES,
  MAX_PUSH_CHARS,
  PHOTO_PREFIX,
  PROTOCOL_HEADER,
  SYNC_PROTOCOL,
  SYNCED_ID,
  sniffImageType,
} from "../../shared/sync.js";

// ---------------------------------------------------------------------------
// Optional sync against the app's own API (same origin, /api). The local
// PouchDB stays the source of truth for the UI; this only moves documents
// between it and the server:
//
//   pull  server changes since the last pull  -> GET  /api/changes
//   push  local edits not yet on the server   -> POST /api/docs   (editor only)
//
// A photo is a document plus an image. The document travels like any other;
// the image is uploaded to /api/photos right before its document is pushed,
// and downloaded right before its document is written locally. Every device
// ends up holding every image, so the app and its backup export stay complete
// offline.
//
// The server keeps one current version per document and the last write wins.
// To know which side holds the newer version, the device remembers, per
// document, the local revision that matched the server the last time the two
// were reconciled (`synced`). A document whose current revision differs from
// that is an unpushed local edit. A document with no entry has never been
// reconciled, and if the server already has that id, the server's copy wins:
// a device joining with old data must not overwrite what is already shared.
//
// Sync is opt-in at build time (VITE_SYNC=1); without it the app is local-only.
// ---------------------------------------------------------------------------

export const syncEnabled = import.meta.env?.VITE_SYNC === "1";

const STATE_ID = "_local/sync";
// Bumped when the set of synced documents grows (v2: photos). A device whose
// state is older re-examines its whole local history once, so documents that
// were created before they could sync are picked up.
const STATE_VERSION = 2;
const PHOTO_ATTACHMENT = "image";
// Images go up one request each before their batch of documents. Keeping few
// per batch bounds what has to be repeated when a batch is interrupted.
const MAX_PHOTOS_PER_PUSH = 5;
const PUSH_DEBOUNCE_MS = 2000;
const POLL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
// Leave headroom under the request cap for the JSON envelope around the docs.
const PUSH_CHARS_BUDGET = MAX_PUSH_CHARS / 2;

// Why a sync cycle stopped: "offline" | "signed-out" | "outdated" | "error".
class SyncError extends Error {
  constructor(kind, detail) {
    super(detail ? `sync ${kind}: ${detail}` : `sync ${kind}`);
    this.kind = kind;
  }
}

const getOrNull = (db, id) =>
  db.get(id).catch((e) => (e.status === 404 ? null : Promise.reject(e)));

export function createSync({
  db = pouch,
  fetchImpl = (...args) => fetch(...args),
  onStatus = () => {},
} = {}) {
  // Performs a request and returns the Response. Statuses listed in `accept`
  // are returned to the caller; any other failure throws a SyncError.
  async function request(path, init = {}, accept = []) {
    let res;
    try {
      // "manual": an expired session answers with a redirect to the login page
      // on another origin. Following it would fail like a network error; not
      // following it lets us tell "signed out" from "offline".
      // The timeout matters because cycles are serialised across tabs: a
      // request that never settles would stall every other tab behind it.
      res = await fetchImpl(path, {
        redirect: "manual",
        credentials: "same-origin",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...init,
        headers: { [PROTOCOL_HEADER]: String(SYNC_PROTOCOL), ...init.headers },
      });
    } catch {
      throw new SyncError("offline");
    }
    if (res.type === "opaqueredirect" || res.status === 401)
      throw new SyncError("signed-out");
    // The server speaks a newer sync contract than this build: stop, and let
    // the UI ask for a reload, rather than store data this build mishandles.
    if (res.status === 426) throw new SyncError("outdated");
    if (!res.ok && !accept.includes(res.status)) {
      throw new SyncError("error", `HTTP ${res.status} on ${path}`);
    }
    return res;
  }

  async function api(path, init) {
    const res = await request(path, init);
    try {
      return await res.json();
    } catch {
      throw new SyncError("error", `non-JSON response on ${path}`);
    }
  }

  // pulledSeq: server sequence already applied. pushedSeq: local change
  // sequence already examined for edits to send. synced: id -> local rev that
  // matched the server. Kept in a _local doc: never synced, survives a reset.
  //
  // applying / pushing are write-ahead notes. A local write and the state that
  // records it cannot be saved atomically, and a POST can be applied by the
  // server while its response is lost. Without the notes, either case would
  // leave a document misclassified on the next cycle and the stale side would
  // overwrite the newer one.
  //   applying: { id, body } - the server version about to be written locally
  //   pushing:  id -> rev    - local revisions sent but not yet acknowledged
  //
  // rejected: id -> rev of photos whose image cannot be synced (not a JPEG,
  // PNG or WebP, or too large). They stay on this device and are not retried
  // until they change, so one bad photo does not hold up everything after it.
  async function loadState() {
    const doc = await getOrNull(db, STATE_ID);
    return {
      v: STATE_VERSION,
      pushedSeq: doc?.v === STATE_VERSION ? (doc.pushedSeq ?? 0) : 0,
      // Pulled again from the start too: an older build skipped documents of
      // kinds it did not know. Re-pulling is safe, it only fills what differs.
      pulledSeq: doc?.v === STATE_VERSION ? (doc.pulledSeq ?? 0) : 0,
      synced: doc?.synced ?? {},
      pushing: doc?.pushing ?? {},
      rejected: doc?.rejected ?? {},
      applying: doc?.applying ?? null,
    };
  }

  async function saveState(state) {
    const doc = await getOrNull(db, STATE_ID);
    await db.put({ _id: STATE_ID, _rev: doc?._rev, ...state });
  }

  // id -> { rev, deleted, doc } for the ids that exist locally (tombstones
  // included, which a plain get() would hide).
  async function localVersions(ids) {
    const found = new Map();
    if (!ids.length) return found;
    const res = await db.allDocs({ keys: ids, include_docs: true });
    for (const row of res.rows) {
      if (!row.value) continue; // never existed here
      found.set(row.key, {
        rev: row.value.rev,
        deleted: !!row.value.deleted,
        doc: row.doc,
      });
    }
    return found;
  }

  // If the previous cycle died between writing a server version locally and
  // recording it, the document now holds exactly that version: mark it synced,
  // so it is not mistaken for a local edit and pushed back.
  async function recoverInterruptedWrite(state) {
    const note = state.applying;
    if (!note) return;
    const local = (await localVersions([note.id])).get(note.id);
    const landed =
      note.body === null
        ? !local || local.deleted
        : !!local && !local.deleted && canonicalBody(local.doc) === note.body;
    if (landed && local) state.synced[note.id] = local.rev;
    state.applying = null;
  }

  // Writes one server change into the local db and returns the local rev that
  // now matches the server (undefined when there is nothing local to match),
  // or null when a concurrent local edit got in first. `beforeWrite` runs
  // right before the database is touched.
  async function apply(change, local, beforeWrite) {
    if (change.deleted) {
      if (!local || local.deleted) return local?.rev;
    } else if (
      !change.mustWrite &&
      local &&
      !local.deleted &&
      canonicalBody(local.doc) === canonicalBody(change.doc)
    ) {
      return local.rev;
    }
    await beforeWrite();
    try {
      if (change.deleted) return (await db.remove(change.id, local.rev)).rev;
      const rev = local && !local.deleted ? local.rev : undefined;
      return (await db.put({ ...change.doc, _id: change.id, _rev: rev })).rev;
    } catch (e) {
      // 409: the doc was edited on this device between the read and the write.
      // The edit stays: an editor uploads it in the push that follows, and a
      // read-only device has it replaced by discardLocalEdits.
      if (e.status === 409) return null;
      throw e;
    }
  }

  // Fetches a photo's image as a PouchDB attachment, or null when the server
  // does not have it or sent something that is not a usable image.
  async function downloadImage(id) {
    const res = await request(photoPath(id), {}, [404]);
    if (res.status === 404) return null;
    const blob = await res.blob();
    // Same rule as for uploads: only a real raster image of sane size is kept.
    const type = sniffImageType(new Uint8Array(await blob.arrayBuffer()));
    if (!type || blob.size > MAX_PHOTO_BYTES) return null;
    return { content_type: type, data: await blobToBase64(blob) };
  }

  // A photo document is only useful locally with its image attached. Returns
  // the change ready to be written: unchanged for anything that is not a live
  // photo, carrying the image already held locally when there is one, and
  // otherwise carrying the image downloaded from the server. Returns null
  // when no usable image could be had.
  async function withImage(change, local) {
    if (change.deleted || !isPhotoId(change.id)) return change;
    const held = !local?.deleted && local?.doc?._attachments?.[PHOTO_ATTACHMENT];
    if (held) {
      return { ...change, doc: { ...change.doc, _attachments: local.doc._attachments } };
    }
    const image = await downloadImage(change.id);
    if (!image) return null;
    return {
      ...change,
      doc: { ...change.doc, _attachments: { [PHOTO_ATTACHMENT]: image } },
      mustWrite: true, // same fields as the local copy, but that one has no image
    };
  }

  // Photos whose image could not be restored, as "id@rev". Kept for the life
  // of the page only, so each is tried again on the next launch but not on
  // every cycle.
  const unrestorable = new Set();

  // Repairs photo documents that are on this device without their image. That
  // happens when a build from before photos synced pulled the document (it
  // knew nothing about images), and it would otherwise never heal: the server
  // has no newer version of the document to send. Only documents that match
  // the server are touched; anything else is for push and pull to settle.
  // Runs last in a cycle and never fails it: a photo that cannot be repaired
  // must not hold up the user's own changes.
  async function restoreMissingImages(state) {
    const res = await db.allDocs({
      startkey: PHOTO_PREFIX,
      endkey: `${PHOTO_PREFIX}\uffff`,
      include_docs: true,
    });
    for (const { doc } of res.rows) {
      if (!isPhotoId(doc._id) || doc._attachments?.[PHOTO_ATTACHMENT]) continue;
      if (state.synced[doc._id] !== doc._rev) continue;
      const attempt = `${doc._id}@${doc._rev}`;
      if (unrestorable.has(attempt)) continue;

      let image;
      try {
        image = await downloadImage(doc._id);
      } catch (e) {
        // Offline, signed out or outdated ends the cycle as usual. A server
        // error for this one image does not.
        if (!(e instanceof SyncError) || e.kind !== "error") throw e;
        image = null;
      }
      if (!image) {
        unrestorable.add(attempt);
        continue;
      }
      // Same write-ahead note as a pulled change: this write must not look
      // like a local edit if the cycle dies before it is recorded.
      state.applying = { id: doc._id, body: canonicalBody(doc) };
      await saveState(state);
      try {
        const { rev } = await db.put({
          ...doc,
          _attachments: { [PHOTO_ATTACHMENT]: image },
        });
        state.synced[doc._id] = rev;
      } catch (e) {
        if (e.status !== 409) throw e; // edited meanwhile: next cycle decides
      }
      state.applying = null;
      await saveState(state);
    }
  }

  async function pull(state, canWrite) {
    for (;;) {
      const page = await api(`/api/changes?since=${state.pulledSeq}`);
      const locals = await localVersions(page.docs.map((change) => change.id));
      for (const change of page.docs) {
        // A kind of document this build does not know: leave it alone.
        if (!SYNCED_ID.test(change.id)) continue;
        const local = locals.get(change.id);
        const known = state.synced[change.id];
        // An editor's unpushed edit beats the incoming version; it goes up in
        // the push that follows. A read-only device can never push, so there
        // the server always wins.
        const unpushed =
          local &&
          ((known !== undefined && local.rev !== known) ||
            state.pushing[change.id] !== undefined);
        if (canWrite && unpushed) continue;

        const incoming = await withImage(change, local);
        if (!incoming) continue; // no usable image: nothing to show for it
        const rev = await apply(incoming, local, async () => {
          state.applying = {
            id: change.id,
            body: change.deleted ? null : canonicalBody(change.doc),
          };
          await saveState(state);
        });
        state.applying = null;
        if (rev === null) continue;
        if (rev === undefined) delete state.synced[change.id];
        else state.synced[change.id] = rev;
      }
      state.pulledSeq = page.lastSeq;
      await saveState(state);
      if (!page.more) break;
    }
  }

  async function push(state) {
    const feed = await db.changes({ since: state.pushedSeq, include_docs: true });

    const pending = [];
    let firstBlockedSeq = null;
    for (const row of feed.results) {
      if (!SYNCED_ID.test(row.id)) continue;
      const rev = row.changes[0].rev;
      const known = state.synced[row.id];
      if (rev === known) continue; // already what the server has
      if (state.rejected[row.id] === rev) continue;
      if (row.deleted) {
        // A doc the server never had needs no tombstone there.
        if (known !== undefined || state.pushing[row.id] !== undefined) {
          pending.push({ entry: { id: row.id, deleted: true }, rev, chars: 0 });
        }
        continue;
      }
      let body;
      try {
        body = canonicalBody(row.doc);
      } catch {
        body = null;
      }
      if (body === null || body.length > MAX_DOC_CHARS) {
        // Not sent: the server would reject the whole batch.
        console.warn(`[sync] ${row.id} is too large or too deep to sync`);
        firstBlockedSeq ??= row.seq;
        continue;
      }
      let image = null;
      if (isPhotoId(row.id)) {
        image = row.doc._attachments?.[PHOTO_ATTACHMENT];
        if (!image) continue; // a photo with no image has nothing to share
        if (image.length > MAX_PHOTO_BYTES) {
          console.warn(`[sync] ${row.id} is too large to sync`);
          firstBlockedSeq ??= row.seq;
          continue;
        }
      }
      pending.push({
        entry: { id: row.id, doc: JSON.parse(body) },
        rev,
        chars: body.length,
        isPhoto: image !== null,
      });
    }

    // Uploads one photo's image. False when it cannot be synced at all; the
    // check also runs on the server, which answers 413 or 415.
    const uploadImage = async (item) => {
      const id = item.entry.id;
      const data = await db.getAttachment(id, PHOTO_ATTACHMENT, { rev: item.rev });
      const bytes =
        data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
      const type = sniffImageType(bytes);
      if (!type || bytes.length > MAX_PHOTO_BYTES) return false;
      const res = await request(
        photoPath(id),
        { method: "PUT", headers: { "content-type": type }, body: bytes },
        [413, 415]
      );
      return res.ok;
    };

    let batch = [];
    let chars = 0;
    let photos = 0;
    const flush = async () => {
      if (!batch.length) return;
      for (const item of batch) state.pushing[item.entry.id] = item.rev;
      await saveState(state);
      // Images first: the server refuses a photo document whose image it does
      // not have, so other devices never receive a photo they cannot load.
      const sendable = [];
      for (const item of batch) {
        if (!item.isPhoto || (await uploadImage(item))) {
          sendable.push(item);
          continue;
        }
        console.warn(
          `[sync] ${item.entry.id} is not a supported image; kept on this device`
        );
        state.rejected[item.entry.id] = item.rev;
        delete state.pushing[item.entry.id];
      }
      if (sendable.length) {
        await api("/api/docs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ docs: sendable.map((item) => item.entry) }),
        });
      }
      for (const item of sendable) {
        state.synced[item.entry.id] = item.rev;
        delete state.pushing[item.entry.id];
        delete state.rejected[item.entry.id];
      }
      await saveState(state);
      batch = [];
      chars = 0;
      photos = 0;
    };
    for (const item of pending) {
      const full =
        batch.length >= MAX_DOCS_PER_PUSH ||
        chars + item.chars > PUSH_CHARS_BUDGET ||
        (item.isPhoto && photos >= MAX_PHOTOS_PER_PUSH);
      if (full) await flush();
      batch.push(item);
      chars += item.chars;
      if (item.isPhoto) photos += 1;
    }
    await flush();

    // A document that cannot be sent keeps the cursor behind it, so it is
    // retried once it shrinks, and the cycle reports an error instead of
    // looking healthy while that document silently stops syncing.
    state.pushedSeq = firstBlockedSeq === null ? feed.last_seq : firstBlockedSeq - 1;
    await saveState(state);
    if (firstBlockedSeq !== null)
      throw new SyncError("error", "a document or photo is too large to sync");
  }

  // A read-only device cannot keep local edits: anything that drifted from
  // what the server sent (an edit, a restored backup) is pulled again in full.
  async function discardLocalEdits(state) {
    const feed = await db.changes({ since: state.pushedSeq });
    let drifted = false;
    let firstLocalOnlySeq = null;
    for (const row of feed.results) {
      if (!SYNCED_ID.test(row.id)) continue;
      const known = state.synced[row.id];
      if (known !== undefined) drifted ||= row.changes[0].rev !== known;
      else if (!row.deleted) firstLocalOnlySeq ??= row.seq;
    }
    if (drifted) {
      state.pulledSeq = 0;
      await pull(state, false);
    }
    // Documents that exist only on this device are left alone, and the cursor
    // stays behind them: if this account is later allowed to write (or was
    // read-only by misconfiguration), they are uploaded instead of stranded.
    state.pushedSeq = firstLocalOnlySeq === null ? feed.last_seq : firstLocalOnlySeq - 1;
    await saveState(state);
  }

  let status = { state: "idle", role: null };
  const setStatus = (next) => {
    status = { ...status, ...next };
    onStatus(status);
  };

  // One full cycle. Resolves to the resulting status; never rejects.
  async function syncOnce() {
    // While retrying after a failure, keep showing that failure until the
    // outcome is known, instead of flashing back to "syncing" on every attempt.
    if (status.state === "idle") setStatus({ state: "syncing" });
    try {
      const me = await api("/api/me");
      if (me.role !== "editor" && me.role !== "reader") {
        throw new SyncError("error", "unexpected role from /api/me");
      }
      const canWrite = me.role === "editor";
      const state = await loadState();
      await recoverInterruptedWrite(state);
      await pull(state, canWrite);
      if (canWrite) await push(state);
      else await discardLocalEdits(state);
      await restoreMissingImages(state);
      setStatus({ state: "idle", role: me.role });
    } catch (e) {
      if (!(e instanceof SyncError)) console.error("[sync] failed", e);
      else if (e.kind === "error") console.error(`[sync] ${e.message}`);
      setStatus({ state: e instanceof SyncError ? e.kind : "error" });
    }
    return status;
  }

  // Background operation: sync now, after local edits, when the tab comes back
  // or the network returns, and on a slow poll. Returns a stop function.
  function start() {
    let running = false;
    let queued = false;
    let timer = null;

    const run = async () => {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      try {
        // One cycle at a time across tabs: they share the local database and
        // the sync state stored in it.
        if (globalThis.navigator?.locks)
          await navigator.locks.request("orchard-sync", syncOnce);
        else await syncOnce();
      } finally {
        running = false;
        if (queued) {
          queued = false;
          run();
        }
      }
    };
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(run, PUSH_DEBOUNCE_MS);
    };
    const whenVisible = () => {
      if (document.visibilityState === "visible") run();
    };

    const feed = db
      .changes({ since: "now", live: true })
      .on("change", soon)
      .on("error", (e) => console.error("[sync] change feed stopped", e));
    const poll = setInterval(whenVisible, POLL_MS);
    document.addEventListener("visibilitychange", whenVisible);
    window.addEventListener("online", run);
    run();

    return () => {
      feed.cancel();
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", whenVisible);
      window.removeEventListener("online", run);
    };
  }

  return { syncOnce, start };
}

// --- App-wide status, for the UI -------------------------------------------
// state: "off" (sync not built in) | "syncing" | "idle" | "offline" |
// "signed-out" | "outdated" | "error". role: null until known, then "editor" |
// "reader".

// The role is remembered between launches so a read-only device starts
// read-only, instead of showing edit controls until the first request answers
// (or indefinitely, when it starts offline).
const ROLE_KEY = "orchard-log:sync-role";

function rememberedRole() {
  try {
    const role = globalThis.localStorage?.getItem(ROLE_KEY);
    return role === "editor" || role === "reader" ? role : null;
  } catch {
    return null; // storage blocked
  }
}

function rememberRole(role) {
  try {
    if (role) globalThis.localStorage?.setItem(ROLE_KEY, role);
  } catch {
    // storage blocked: the role is simply asked again next launch
  }
}

let appStatus = {
  state: syncEnabled ? "syncing" : "off",
  role: syncEnabled ? rememberedRole() : null,
};
const listeners = new Set();

export const getSyncStatus = () => appStatus;

export function subscribeSyncStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// App boot: start background sync iff this build has it enabled.
export function startSyncIfConfigured() {
  if (!syncEnabled) return null;
  const sync = createSync({
    onStatus: (next) => {
      // A failed cycle reports no role; keep the last known one.
      appStatus = { ...next, role: next.role ?? appStatus.role };
      rememberRole(next.role);
      for (const listener of listeners) listener();
    },
  });
  return sync.start();
}
