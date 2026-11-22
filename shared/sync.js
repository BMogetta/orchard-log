// The sync contract both sides agree on: which documents travel, how big they
// may be, and what "same content" means. Imported by the app (src/data/sync.js)
// and by the API (server/), so a device never sends something the server would
// reject, which would otherwise stall its whole push queue.

// Only these document families sync. Photos are intentionally excluded for now
// (they are large binary attachments), and anything else is local-only state.
export const SYNCED_ID = /^(tree|event|settings):[A-Za-z0-9_.:-]{1,128}$/;
export const MAX_DOCS_PER_PUSH = 100;
export const MAX_DOC_CHARS = 100_000;
export const MAX_PUSH_CHARS = 2_000_000;
const MAX_DEPTH = 32;

function sortKeys(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new RangeError("document nested too deeply");
  if (Array.isArray(value)) return value.map((item) => sortKeys(item, depth + 1));
  if (value && typeof value === "object") {
    // Null prototype: a key literally named "__proto__" is data, not a setter.
    const out = Object.create(null);
    for (const key of Object.keys(value).sort())
      out[key] = sortKeys(value[key], depth + 1);
    return out;
  }
  return value;
}

// Canonical JSON for a document body: local bookkeeping fields (`_id`, `_rev`,
// `_attachments`...) dropped and keys sorted, so the same content always
// serialises to the same string. That is what makes re-pushing an unchanged
// document a no-op instead of a new change every device has to pull again.
// Throws RangeError for a body nested beyond MAX_DEPTH.
export function canonicalBody(doc) {
  const body = {};
  for (const [key, value] of Object.entries(doc ?? {})) {
    if (!key.startsWith("_")) body[key] = value;
  }
  return JSON.stringify(sortKeys(body));
}
