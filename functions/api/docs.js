import { error, json } from "../../server/http.js";
import { deletePhotos, hasPhoto } from "../../server/photos.js";
import {
  canonicalBody,
  isPhotoId,
  writeDocs,
  MAX_DOC_CHARS,
  MAX_DOCS_PER_PUSH,
  MAX_PUSH_CHARS,
  SYNCED_ID,
} from "../../server/store.js";

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// POST /api/docs { docs: [{ id, deleted?, doc? }] } -> { written }
// Photo documents travel here too; their images go through /api/photos.
// Editor only. The whole request is validated before anything is written, so a
// bad entry rejects the batch instead of half-applying it.
export async function onRequestPost({ request, env, data }) {
  if (data.user.role !== "editor") return error(403, "read-only");

  // Requiring JSON forces a CORS preflight on cross-site callers, which this
  // API never answers.
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return error(415, "content-type must be application/json");
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_PUSH_CHARS) {
    return error(413, "request too large");
  }
  const text = await request.text();
  if (text.length > MAX_PUSH_CHARS) return error(413, "request too large");

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return error(400, "invalid JSON");
  }
  if (!isPlainObject(payload) || !Array.isArray(payload.docs)) {
    return error(400, "expected { docs: [...] }");
  }
  if (payload.docs.length > MAX_DOCS_PER_PUSH) {
    return error(413, `at most ${MAX_DOCS_PER_PUSH} docs per request`);
  }

  const docs = [];
  const seen = new Set();
  for (const entry of payload.docs) {
    if (
      !isPlainObject(entry) ||
      typeof entry.id !== "string" ||
      !SYNCED_ID.test(entry.id)
    ) {
      return error(400, "invalid doc id");
    }
    // One entry per document: with two, which one "wins" would differ between
    // the document store and the image store.
    if (seen.has(entry.id)) return error(400, `duplicate doc id: ${entry.id}`);
    seen.add(entry.id);
    const deleted = entry.deleted === true;
    if (!deleted && !isPlainObject(entry.doc))
      return error(400, `missing doc for ${entry.id}`);
    let body = "{}";
    if (!deleted) {
      try {
        body = canonicalBody(entry.doc);
      } catch {
        return error(400, `invalid doc: ${entry.id}`);
      }
    }
    if (body.length > MAX_DOC_CHARS) return error(413, `doc too large: ${entry.id}`);
    docs.push({ id: entry.id, deleted, body });
  }

  if (!docs.length) return json({ written: 0 });

  // A photo document without its image would reach other devices as a broken
  // photo, so the image has to be uploaded first.
  for (const doc of docs) {
    if (!doc.deleted && isPhotoId(doc.id) && !(await hasPhoto(env.PHOTOS, doc.id))) {
      return error(409, `photo image not uploaded: ${doc.id}`);
    }
  }

  const result = await writeDocs(env.DB, docs, data.user.email);
  // After the tombstones are stored: a failure here leaves an unreferenced
  // image behind, never a document pointing at a missing one.
  await deletePhotos(
    env.PHOTOS,
    docs.filter((doc) => doc.deleted && isPhotoId(doc.id)).map((doc) => doc.id)
  );
  return json(result);
}
