// Photo images live in a private R2 bucket, keyed by the photo document id.
// The bucket has no public URL: images are only reachable through the API, so
// they sit behind the same identity checks as everything else.

export async function putPhoto(bucket, id, bytes, type, email) {
  await bucket.put(id, bytes, {
    httpMetadata: { contentType: type },
    customMetadata: { uploadedBy: email },
  });
}

// Returns { bytes, type } or null.
export async function getPhoto(bucket, id) {
  const object = await bucket.get(id);
  if (!object) return null;
  return {
    bytes: await object.arrayBuffer(),
    type: object.httpMetadata?.contentType ?? "application/octet-stream",
  };
}

export async function hasPhoto(bucket, id) {
  return (await bucket.head(id)) !== null;
}

export async function deletePhotos(bucket, ids) {
  if (ids.length) await bucket.delete(ids);
}
