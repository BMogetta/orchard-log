// Test-only adapter (aliased in for adapter.js under Vitest). Pure in-memory,
// so it needs no IndexedDB and avoids pouchdb-adapter-idb/fake-indexeddb issues.
import plugin from "pouchdb-adapter-memory";

export const adapterPlugin = plugin;
export const adapterName = "memory";
