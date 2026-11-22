// The sync contract both sides agree on: which documents travel, how big they
// may be, and what "same content" means. Imported by the app (src/data/sync.js)
// and by the API (server/), so a device never sends something the server would
// reject, which would otherwise stall its whole push queue.

// Version of the sync contract, sent by the app on every API request. The API
// refuses older versions: a tab still running an old build does not know the
// newer document families, and would store what it pulls incorrectly (a photo
// without its image, for example). Bump it whenever an old client could
// mishandle what the server now sends.
export const SYNC_PROTOCOL = 2;
export const PROTOCOL_HEADER = "x-orchard-sync";

// Only these document families sync; anything else is local-only state.
// A photo travels in two parts: its document (which tree and event it belongs
// to) through the same channel as every other document, and its image through
// /api/photos/<name>, where <name> is the id without the "photo:" prefix. That
// is why a photo id allows no further ":" (it has to fit in one path segment)
// and must start with a letter or digit ("." and ".." mean something in a URL).
export const SYNCED_ID =
  /^(?:(?:tree|event|settings):[A-Za-z0-9_.:-]{1,128}|photo:[A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/;
export const PHOTO_PREFIX = "photo:";
export const isPhotoId = (id) => id.startsWith(PHOTO_PREFIX) && SYNCED_ID.test(id);
export const photoPath = (id) => `/api/photos/${id.slice(PHOTO_PREFIX.length)}`;
// Photos are downscaled on capture, so real ones are far below this.
export const MAX_PHOTO_BYTES = 5_000_000;

// The image type, read from the bytes: "image/jpeg" | "image/png" |
// "image/webp" | null. Only raster formats count. The server stores and serves
// images from the app's own origin, where an SVG or HTML file could run
// script, so what a file claims to be is never used.
export function sniffImageType(bytes) {
  const starts = (...sig) => sig.every((b, i) => bytes[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  const ascii = (from, text) =>
    [...text].every((c, i) => bytes[from + i] === c.charCodeAt(0));
  if (bytes.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}
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
