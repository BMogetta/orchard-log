// fake-indexeddb/auto installs a real in-memory IndexedDB into the global
// scope so Dexie (and later PouchDB) work under Node without a browser.
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
