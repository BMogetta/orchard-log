import { useSyncExternalStore } from "react";
import { getSyncStatus, subscribeSyncStatus } from "./sync.js";

// Whether this device may change data. Always true without sync (local-only
// and demo builds). With sync, false for a read-only account: the server
// rejects its writes and the next sync discards them, so the UI does not offer
// them. This is a courtesy, not the access control; that lives in the API.
//
// While the role is still unknown (first launch on a device) the controls stay
// hidden until the first sync attempt settles, so a read-only account is never
// offered them. If that attempt ends without an answer (offline), they are
// shown: hiding them would lock the owner out of their own offline data.
export function useCanEdit() {
  const { state, role } = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  if (state === "off" || role === "editor") return true;
  if (role === "reader") return false;
  return state !== "syncing";
}
