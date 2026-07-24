// Production adapter: the browser's IndexedDB. Tests alias this module to
// adapter.memory.js (see vitest.config.js) because pouchdb-adapter-idb is flaky
// on fake-indexeddb; the in-memory adapter is used there instead.
import plugin from "pouchdb-adapter-idb";

export const adapterPlugin = plugin;
export const adapterName = "idb";
