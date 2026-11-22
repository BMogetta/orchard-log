import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The role a device had last time is remembered, so a read-only device starts
// read-only even before (or without) reaching the server.

if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
}

const ROLE_KEY = "orchard-log:sync-role";

async function loadSync({ enabled }) {
  vi.resetModules();
  if (enabled) vi.stubEnv("VITE_SYNC", "1");
  return import("../src/data/sync.js");
}

// Poll: the status changes when the first background cycle settles.
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("until: timed out");
}

const jsonResponse = (body) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

let stop;

beforeEach(() => {
  localStorage.removeItem(ROLE_KEY);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("remembered sync role", () => {
  it("starts with the role stored on the device", async () => {
    localStorage.setItem(ROLE_KEY, "reader");
    const sync = await loadSync({ enabled: true });
    expect(sync.getSyncStatus()).toEqual({ state: "syncing", role: "reader" });
  });

  it("ignores a stored value that is not a role", async () => {
    localStorage.setItem(ROLE_KEY, "admin");
    const sync = await loadSync({ enabled: true });
    expect(sync.getSyncStatus().role).toBeNull();
  });

  it("ignores the stored role in a build without sync", async () => {
    localStorage.setItem(ROLE_KEY, "reader");
    const sync = await loadSync({ enabled: false });
    expect(sync.getSyncStatus()).toEqual({ state: "off", role: null });
    expect(sync.startSyncIfConfigured()).toBeNull();
  });

  it("keeps the role through a failed cycle", async () => {
    localStorage.setItem(ROLE_KEY, "reader");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const sync = await loadSync({ enabled: true });
    stop = sync.startSyncIfConfigured();

    await until(() => sync.getSyncStatus().state === "offline");
    expect(sync.getSyncStatus().role).toBe("reader");
    expect(localStorage.getItem(ROLE_KEY)).toBe("reader");
  });

  it("turns read-only when the server says so, and remembers it", async () => {
    localStorage.setItem(ROLE_KEY, "editor");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) =>
        String(path).startsWith("/api/me")
          ? jsonResponse({ email: "someone@example.com", role: "reader" })
          : jsonResponse({ docs: [], lastSeq: 0, more: false })
      )
    );
    const sync = await loadSync({ enabled: true });
    expect(sync.getSyncStatus().role).toBe("editor");
    stop = sync.startSyncIfConfigured();

    await until(() => sync.getSyncStatus().state === "idle");
    expect(sync.getSyncStatus().role).toBe("reader");
    expect(localStorage.getItem(ROLE_KEY)).toBe("reader");
  });

  it("treats a reply without a valid role as an error and keeps the known role", async () => {
    localStorage.setItem(ROLE_KEY, "reader");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ email: "x@example.com", role: "admin" }))
    );
    const sync = await loadSync({ enabled: true });
    stop = sync.startSyncIfConfigured();

    await until(() => sync.getSyncStatus().state === "error");
    expect(sync.getSyncStatus().role).toBe("reader");
    expect(localStorage.getItem(ROLE_KEY)).toBe("reader");
  });

  it("works with storage that throws, asking for the role each launch", async () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) =>
        String(path).startsWith("/api/me")
          ? jsonResponse({ email: "editor@example.com", role: "editor" })
          : jsonResponse({ docs: [], lastSeq: 0, more: false })
      )
    );
    const sync = await loadSync({ enabled: true });
    expect(sync.getSyncStatus().role).toBeNull();
    stop = sync.startSyncIfConfigured();

    await until(() => sync.getSyncStatus().state === "idle");
    expect(sync.getSyncStatus().role).toBe("editor");
  });

  it("stores the role the server reports, replacing the old one", async () => {
    localStorage.setItem(ROLE_KEY, "reader");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) =>
        String(path).startsWith("/api/me")
          ? jsonResponse({ email: "editor@example.com", role: "editor" })
          : jsonResponse({ docs: [], lastSeq: 0, more: false })
      )
    );
    const sync = await loadSync({ enabled: true });
    stop = sync.startSyncIfConfigured();

    await until(() => sync.getSyncStatus().state === "idle");
    expect(sync.getSyncStatus().role).toBe("editor");
    expect(localStorage.getItem(ROLE_KEY)).toBe("editor");
  });
});
