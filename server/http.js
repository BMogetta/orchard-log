// API responses are per-user and change on every write: never cache them.
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const error = (status, message) => json({ error: message }, status);
