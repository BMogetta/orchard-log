import { useLiveQuery } from "dexie-react-hooks";

// Reactive-query seam. Components call useLive() instead of importing a
// database library directly, so the storage engine can change underneath them.
// Today it delegates to dexie-react-hooks; Phase 2 (PouchDB) reimplements this
// over the changes feed without touching a single call site.
export function useLive(querier, deps = [], fallback) {
  return useLiveQuery(querier, deps, fallback);
}
