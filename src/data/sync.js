import { pouch } from "./backend.js";
import {
  canonicalBody,
  MAX_DOC_CHARS,
  MAX_DOCS_PER_PUSH,
  MAX_PUSH_CHARS,
  SYNCED_ID,
} from "../../shared/sync.js";

// ---------------------------------------------------------------------------
// Optional sync against the app's own API (same origin, /api). The local
// PouchDB stays the source of truth for the UI; this only moves documents
// between it and the server:
//
//   pull  server changes since the last pull  -> GET  /api/changes
//   push  local edits not yet on the server   -> POST /api/docs   (editor only)
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
const PUSH_DEBOUNCE_MS = 2000;
const POLL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
// Leave headroom under the request cap for the JSON envelope around the docs.
const PUSH_CHARS_BUDGET = MAX_PUSH_CHARS / 2;

// Why a sync cycle stopped: "offline" | "signed-out" | "error".
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
  async function api(path, init = {}) {
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
      });
    } catch {
      throw new SyncError("offline");
    }
    if (res.type === "opaqueredirect" || res.status === 401)
      throw new SyncError("signed-out");
    if (!res.ok) throw new SyncError("error", `HTTP ${res.status} on ${path}`);
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
  async function loadState() {
    const doc = await getOrNull(db, STATE_ID);
    return {
      pushedSeq: doc?.pushedSeq ?? 0,
      pulledSeq: doc?.pulledSeq ?? 0,
      synced: doc?.synced ?? {},
      pushing: doc?.pushing ?? {},
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

  async function pull(state, canWrite) {
    for (;;) {
      const page = await api(`/api/changes?since=${state.pulledSeq}`);
      const locals = await localVersions(page.docs.map((change) => change.id));
      for (const change of page.docs) {
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

        const rev = await apply(change, local, async () => {
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
      pending.push({
        entry: { id: row.id, doc: JSON.parse(body) },
        rev,
        chars: body.length,
      });
    }

    let batch = [];
    let chars = 0;
    const flush = async () => {
      if (!batch.length) return;
      for (const item of batch) state.pushing[item.entry.id] = item.rev;
      await saveState(state);
      await api("/api/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docs: batch.map((item) => item.entry) }),
      });
      for (const item of batch) {
        state.synced[item.entry.id] = item.rev;
        delete state.pushing[item.entry.id];
      }
      await saveState(state);
      batch = [];
      chars = 0;
    };
    for (const item of pending) {
      if (batch.length >= MAX_DOCS_PER_PUSH || chars + item.chars > PUSH_CHARS_BUDGET)
        await flush();
      batch.push(item);
      chars += item.chars;
    }
    await flush();

    // A document that cannot be sent keeps the cursor behind it, so it is
    // retried once it shrinks, and the cycle reports an error instead of
    // looking healthy while that document silently stops syncing.
    state.pushedSeq = firstBlockedSeq === null ? feed.last_seq : firstBlockedSeq - 1;
    await saveState(state);
    if (firstBlockedSeq !== null)
      throw new SyncError("error", "a document is too large to sync");
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
// "signed-out" | "error". role: null until known, then "editor" | "reader".

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
