import { error, json } from "../../../server/http.js";
import { getPhoto, putPhoto } from "../../../server/photos.js";
import {
  MAX_PHOTO_BYTES,
  PHOTO_PREFIX,
  isPhotoId,
  sniffImageType,
} from "../../../server/store.js";

// The image of one photo. <name> is the photo document id without its prefix.
//   GET /api/photos/<name>   anyone signed in
//   PUT /api/photos/<name>   editor only, body = the image bytes
// A device uploads the image before it pushes the photo's document, and the
// image is deleted when that document is deleted (see docs.js).

function photoId(params) {
  const id = `${PHOTO_PREFIX}${params.name}`;
  return isPhotoId(id) ? id : null;
}

// Reads the body without trusting content-length: stops as soon as it passes
// `max` instead of buffering whatever was sent. Returns null when it is over.
async function readAtMost(request, max) {
  const chunks = [];
  let total = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function onRequestGet({ env, params }) {
  const id = photoId(params);
  if (!id) return error(400, "invalid photo id");
  const photo = await getPhoto(env.PHOTOS, id);
  if (!photo) return error(404, "not found");
  return new Response(photo.bytes, {
    headers: {
      "content-type": photo.type,
      "cache-control": "no-store",
      // Served from the app's own origin: make sure a browser can only ever
      // treat this as an image, whatever the bytes are.
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}

export async function onRequestPut({ request, env, params, data }) {
  if (data.user.role !== "editor") return error(403, "read-only");
  const id = photoId(params);
  if (!id) return error(400, "invalid photo id");

  if (Number(request.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES) {
    return error(413, "photo too large");
  }
  const bytes = await readAtMost(request, MAX_PHOTO_BYTES);
  if (!bytes) return error(413, "photo too large");

  const type = sniffImageType(bytes);
  if (!type) return error(415, "not a JPEG, PNG or WebP image");

  await putPhoto(env.PHOTOS, id, bytes, type, data.user.email);
  return json({ id, type, size: bytes.length });
}
