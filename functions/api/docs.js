import { error, json } from "../../server/http.js";
import {
  canonicalBody,
  writeDocs,
  MAX_DOC_CHARS,
  MAX_DOCS_PER_PUSH,
  MAX_PUSH_CHARS,
  SYNCED_ID,
} from "../../server/store.js";

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// POST /api/docs { docs: [{ id, deleted?, doc? }] } -> { written }
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
  for (const entry of payload.docs) {
    if (
      !isPlainObject(entry) ||
      typeof entry.id !== "string" ||
      !SYNCED_ID.test(entry.id)
    ) {
      return error(400, "invalid doc id");
    }
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
  return json(await writeDocs(env.DB, docs, data.user.email));
}
