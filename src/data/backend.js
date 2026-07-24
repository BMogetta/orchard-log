import PouchDB from "pouchdb-core";
// Resolved by build config: prod -> adapter.js (idb), tests -> adapter.memory.js
// (see vite.config.js / vitest.config.js resolve.alias).
import { adapterPlugin, adapterName } from "@adapter";

// ---------------------------------------------------------------------------
// PouchDB backend. One local database, typed by `_id` prefix:
//   tree:<uuid>   event:<uuid>   photo:<uuid>
// Photos are stored as base64 attachments (see blobToBase64) — env-agnostic,
// because PouchDB expects Blobs only in the browser and base64/Buffer in Node.
// Sync (Phase 3) attaches live replication to this same instance.
// ---------------------------------------------------------------------------

PouchDB.plugin(adapterPlugin);

export const pouch = new PouchDB("orchard", { adapter: adapterName });

// crypto.randomUUID needs a secure context (missing on plain-http LAN), so fall
// back to getRandomValues, which is available everywhere.
export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000; // avoid apply() arg-count limits on big images
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBlob(b64, type = "image/jpeg") {
  const binary = atob(b64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

// All docs whose _id is in the `${prefix}:` range.
export async function allOfType(prefix, opts = {}) {
  const res = await pouch.allDocs({
    startkey: `${prefix}:`,
    endkey: `${prefix}:￿`,
    include_docs: true,
    ...opts,
  });
  return res.rows.map((r) => r.doc);
}

// Delete every user doc (leaves _local/* like the migration flag). Used by the
// demo reset and by backup restore in replace mode.
export async function resetDatabase() {
  const all = await pouch.allDocs();
  if (!all.rows.length) return;
  await pouch.bulkDocs(
    all.rows.map((r) => ({ _id: r.id, _rev: r.value.rev, _deleted: true }))
  );
}
