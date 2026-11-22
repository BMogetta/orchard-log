import { error, json } from "../../server/http.js";
import { readChanges } from "../../server/store.js";

// GET /api/changes?since=<seq> -> { docs, lastSeq, more }
// A device passes the last seq it applied (0 on first sync) and repeats while
// `more` is true.
export async function onRequestGet({ request, env }) {
  const raw = new URL(request.url).searchParams.get("since") ?? "0";
  if (!/^\d{1,15}$/.test(raw)) return error(400, "since must be a non-negative integer");
  return json(await readChanges(env.DB, Number(raw)));
}
