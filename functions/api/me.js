import { json } from "../../server/http.js";

// Who the caller is and whether they may write. The app uses this to decide
// between two-way sync and read-only mode.
export function onRequestGet({ data }) {
  return json(data.user);
}
