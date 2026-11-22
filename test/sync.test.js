// @vitest-environment node
import { readFileSync } from "node:fs";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { getPlatformProxy } from "wrangler";
import PouchDB from "pouchdb-core";
import "../src/data/backend.js"; // registers the in-memory adapter under test
import { createSync } from "../src/data/sync.js";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import { onRequestGet as getMe } from "../functions/api/me.js";
import { onRequestGet as getChanges } from "../functions/api/changes.js";
import { onRequestPost as postDocs } from "../functions/api/docs.js";
import { readChanges } from "../server/store.js";

// End-to-end coverage for device sync: the app's real sync engine on real
// (in-memory) PouchDB databases, talking to the real API handlers on a real
// local D1. Each "device" is its own PouchDB; identity is chosen per device.

const EDITOR = "editor@example.com";
const READER = "reader@example.com";
const ROUTES = {
  "GET /api/me": getMe,
  "GET /api/changes": getChanges,
  "POST /api/docs": postDocs,
};

let platform;
let d1;
let deviceCounter = 0;
const devices = [];
let requests; // every call the devices made, as "METHOD /path"

// A fetch that reaches the API in-process as `email`. `before` runs ahead of
// each request, to stage things that happen mid-sync.
function apiAs(email, { before } = {}) {
  return async (path, init = {}) => {
    const method = init.method ?? "GET";
    requests.push(`${method} ${path}`);
    await before?.(method, path);
    const request = new Request(`http://localhost${path}`, {
      method,
      headers: init.headers,
      body: init.body,
    });
    const handler = ROUTES[`${method} ${new URL(request.url).pathname}`];
    const context = {
      request,
      env: { DB: d1, DEV_USER_EMAIL: email, EDITOR_EMAIL: EDITOR },
      data: {},
    };
    context.next = () => handler(context);
    return middleware(context);
  };
}

function device(email, options) {
  const db = new PouchDB(`device-${++deviceCounter}`, { adapter: "memory" });
  devices.push(db);
  const statuses = [];
  const sync = createSync({
    db,
    fetchImpl: apiAs(email, options),
    onStatus: (s) => statuses.push(s.state),
  });
  return { db, statuses, sync: sync.syncOnce };
}

const bodyOf = ({ _id, _rev, ...rest }) => rest;
const serverDocs = async () =>
  Object.fromEntries(
    (await readChanges(d1, 0, 1000)).docs.map((d) => [
      d.id,
      d.deleted ? "deleted" : d.doc,
    ])
  );
const posts = () => requests.filter((r) => r.startsWith("POST")).length;

beforeAll(async () => {
  platform = await getPlatformProxy({ persist: false });
  d1 = platform.env.DB;
  const schema = readFileSync(
    new URL("../migrations/0001_init.sql", import.meta.url),
    "utf8"
  );
  for (const sql of schema.replace(/^--.*$/gm, "").split(";")) {
    if (sql.trim()) await d1.prepare(sql).run();
  }
});

afterAll(async () => {
  await platform?.dispose();
});

beforeEach(async () => {
  requests = [];
  await d1.batch([
    d1.prepare("DELETE FROM docs"),
    d1.prepare("UPDATE meta SET value = 0 WHERE key = 'seq'"),
  ]);
});

afterEach(async () => {
  while (devices.length) await devices.pop().destroy();
  vi.restoreAllMocks();
});

describe("first sync", () => {
  it("uploads data that already existed on the editor's device, except photos", async () => {
    const a = device(EDITOR);
    await a.db.bulkDocs([
      { _id: "tree:1", commonName: "Meyer Lemon", careSchedule: [] },
      { _id: "event:1", treeId: "tree:1", type: "note", notes: "repotted" },
      { _id: "settings:zones", zones: ["north wall"] },
      { _id: "photo:1", treeId: "tree:1" },
    ]);

    expect((await a.sync()).state).toBe("idle");

    expect(await serverDocs()).toEqual({
      "tree:1": { commonName: "Meyer Lemon", careSchedule: [] },
      "event:1": { treeId: "tree:1", type: "note", notes: "repotted" },
      "settings:zones": { zones: ["north wall"] },
    });
  });

  it("does not upload deletions that predate it", async () => {
    const a = device(EDITOR);
    const { rev } = await a.db.put({ _id: "tree:old", commonName: "Gone" });
    await a.db.remove("tree:old", rev);
    await a.db.put({ _id: "tree:1", commonName: "Fig" });

    await a.sync();
    expect(Object.keys(await serverDocs())).toEqual(["tree:1"]);
  });

  it("brings a new device up to date across several pages and batches", async () => {
    const a = device(EDITOR);
    const docs = Array.from({ length: 250 }, (_, i) => ({ _id: `tree:${i}`, n: i }));
    await a.db.bulkDocs(docs);
    await a.sync();
    expect(posts()).toBe(3); // 100 docs per request

    const b = device(READER);
    await b.sync();
    const pulled = await b.db.allDocs({ startkey: "tree:", endkey: "tree:￿" });
    expect(pulled.rows).toHaveLength(250);
    expect(
      requests.filter((r) => r.startsWith("GET /api/changes")).length
    ).toBeGreaterThan(2);
  });
});

describe("editor to other devices", () => {
  it("propagates creates, edits and deletes", async () => {
    const a = device(EDITOR);
    const b = device(READER);
    await a.db.put({ _id: "tree:1", commonName: "Fig" });
    await a.db.put({ _id: "tree:2", commonName: "Plum" });
    await a.sync();
    await b.sync();
    expect(bodyOf(await b.db.get("tree:1"))).toEqual({ commonName: "Fig" });

    const fig = await a.db.get("tree:1");
    await a.db.put({ ...fig, commonName: "Brown Turkey Fig" });
    await a.db.remove(await a.db.get("tree:2"));
    await a.sync();
    await b.sync();

    expect(bodyOf(await b.db.get("tree:1"))).toEqual({ commonName: "Brown Turkey Fig" });
    await expect(b.db.get("tree:2")).rejects.toMatchObject({ status: 404 });
  });

  it("reaches the editor's own second device, and edits flow back", async () => {
    const a = device(EDITOR);
    const b = device(EDITOR);
    await a.db.put({ _id: "tree:1", commonName: "Fig" });
    await a.sync();
    await b.sync();

    await b.db.put({ ...(await b.db.get("tree:1")), commonName: "Fig (terrace)" });
    await b.sync();
    await a.sync();
    expect(bodyOf(await a.db.get("tree:1"))).toEqual({ commonName: "Fig (terrace)" });
  });
});

describe("read-only devices", () => {
  it("never upload, and the server version replaces their local edits", async () => {
    const a = device(EDITOR);
    const b = device(READER);
    await a.db.put({ _id: "tree:1", commonName: "Fig" });
    await a.sync();
    await b.sync();
    requests = [];

    await b.db.put({ ...(await b.db.get("tree:1")), commonName: "Reader edit" });
    await b.db.put({ _id: "tree:mine", commonName: "Reader's own" });
    expect((await b.sync()).role).toBe("reader");
    expect(posts()).toBe(0);
    expect(Object.keys(await serverDocs())).toEqual(["tree:1"]);

    await a.db.put({ ...(await a.db.get("tree:1")), commonName: "Editor edit" });
    await a.sync();
    await b.sync();
    expect(bodyOf(await b.db.get("tree:1"))).toEqual({ commonName: "Editor edit" });
  });
});

describe("not echoing pulled data", () => {
  it("makes no upload when nothing changed locally", async () => {
    const a = device(EDITOR);
    const b = device(EDITOR);
    await a.db.put({ _id: "tree:1", commonName: "Fig" });
    await a.sync();
    await b.sync();
    requests = [];

    await a.sync();
    await b.sync();
    expect(posts()).toBe(0);
  });

  it("does not overwrite a newer server version with content it pulled earlier", async () => {
    const a = device(EDITOR);
    const b = device(EDITOR);
    await a.db.put({ _id: "tree:1", commonName: "v1" });
    await a.sync();
    await b.sync(); // b now holds v1, written by the pull

    await a.db.put({ ...(await a.db.get("tree:1")), commonName: "v2" });
    await a.sync();

    await b.sync();
    expect((await serverDocs())["tree:1"]).toEqual({ commonName: "v2" });
    expect(bodyOf(await b.db.get("tree:1"))).toEqual({ commonName: "v2" });
  });

  // The narrowest window: the user saves after the engine read the local
  // document and before it writes the server's version over it.
  function editDuringApply(target, edit) {
    const realAllDocs = target.db.allDocs.bind(target.db);
    let armed = true;
    target.db.allDocs = async (opts) => {
      const res = await realAllDocs(opts);
      if (armed && opts?.keys?.includes("tree:1")) {
        armed = false;
        await target.db.put({ ...(await target.db.get("tree:1")), ...edit });
      }
      return res;
    };
  }

  it("keeps an editor's edit made while a pull is writing, and uploads it", async () => {
    const a = device(EDITOR);
    await a.db.put({ _id: "tree:1", commonName: "v1" });
    await a.sync();
    const b = device(EDITOR);
    await b.sync();

    await a.db.put({ ...(await a.db.get("tree:1")), commonName: "v2" });
    await a.sync();

    editDuringApply(b, { commonName: "typed mid-sync" });
    await b.sync();
    expect(bodyOf(await b.db.get("tree:1"))).toEqual({ commonName: "typed mid-sync" });
    expect((await serverDocs())["tree:1"]).toEqual({ commonName: "typed mid-sync" });
  });

  it("replaces a reader's edit made while a pull is writing", async () => {
    const a = device(EDITOR);
    await a.db.put({ _id: "tree:1", commonName: "v1" });
    await a.sync();
    const b = device(READER);
    await b.sync();

    await a.db.put({ ...(await a.db.get("tree:1")), commonName: "v2" });
    await a.sync();

    editDuringApply(b, { commonName: "reader typing" });
    await b.sync();
    expect(bodyOf(await b.db.get("tree:1"))).toEqual({ commonName: "v2" });
  });
});

describe("devices that hold stale data", () => {
  // A device whose identity or network can be changed between cycles.
  function flexible(fetchFor) {
    const db = new PouchDB(`device-${++deviceCounter}`, { adapter: "memory" });
    devices.push(db);
    return { db, sync: createSync({ db, fetchImpl: fetchFor }).syncOnce };
  }

  it("does not push back what it pulled before an interrupted pull", async () => {
    const a = device(EDITOR);
    await a.db.bulkDocs(
      Array.from({ length: 250 }, (_, i) => ({
        _id: `tree:${String(i).padStart(3, "0")}`,
        v: 1,
      }))
    );
    await a.sync();

    const online = apiAs(EDITOR);
    let failFromPage = 2;
    let pages = 0;
    const b = flexible((path, init) => {
      if (path.startsWith("/api/changes") && ++pages >= failFromPage) {
        return Promise.reject(new TypeError("network"));
      }
      return online(path, init);
    });
    expect((await b.sync()).state).toBe("offline"); // first page applied, second lost
    expect(bodyOf(await b.db.get("tree:000"))).toEqual({ v: 1 });

    await a.db.put({ ...(await a.db.get("tree:000")), v: 2 });
    await a.sync();

    failFromPage = Infinity;
    expect((await b.sync()).state).toBe("idle");
    expect((await serverDocs())["tree:000"]).toEqual({ v: 2 });
    expect(bodyOf(await b.db.get("tree:000"))).toEqual({ v: 2 });
  });

  it("does not push a stale copy when a read-only device becomes the editor", async () => {
    const a = device(EDITOR);
    await a.db.put({ _id: "tree:1", v: 1 });
    await a.sync();

    let email = READER;
    const b = flexible((path, init) => apiAs(email)(path, init));
    await b.sync();

    await a.db.put({ ...(await a.db.get("tree:1")), v: 2 });
    await a.sync();

    email = EDITOR;
    await b.sync();
    expect((await serverDocs())["tree:1"]).toEqual({ v: 2 });
    expect(bodyOf(await b.db.get("tree:1"))).toEqual({ v: 2 });
  });

  it("lets the server win on a first sync when both sides have the same ids", async () => {
    const a = device(EDITOR);
    await a.db.bulkDocs([
      { _id: "tree:1", v: 2 },
      { _id: "tree:2", v: 1 },
    ]);
    await a.sync();
    await a.db.remove(await a.db.get("tree:2"));
    await a.sync();

    // Another device of the editor, restored from an older backup.
    const b = device(EDITOR);
    await b.db.bulkDocs([
      { _id: "tree:1", v: 1 },
      { _id: "tree:2", v: 1 },
      { _id: "tree:only-here", v: 1 },
    ]);
    await b.sync();

    expect(await serverDocs()).toEqual({
      "tree:1": { v: 2 },
      "tree:2": "deleted",
      "tree:only-here": { v: 1 }, // unknown to the server, so it is uploaded
    });
    expect(bodyOf(await b.db.get("tree:1"))).toEqual({ v: 2 });
    await expect(b.db.get("tree:2")).rejects.toMatchObject({ status: 404 });
  });

  it("does not echo pulled docs when the user edits another doc mid-sync", async () => {
    const a = device(EDITOR);
    await a.db.bulkDocs([
      { _id: "tree:1", v: 1 },
      { _id: "tree:y", v: 1 },
    ]);
    await a.sync();

    let armed = false;
    const b = device(EDITOR, {
      before: async (method) => {
        if (!armed || method !== "POST") return;
        armed = false;
        await b.db.put({ ...(await b.db.get("tree:y")), v: "user" });
      },
    });
    await b.sync();
    await b.db.put({ _id: "tree:new", v: 1 }); // gives the next cycle something to POST

    await a.db.put({ ...(await a.db.get("tree:1")), v: 2 });
    await a.sync();
    armed = true;
    await b.sync(); // pulls tree:1 v2; the user edits tree:y during the push

    await a.db.put({ ...(await a.db.get("tree:1")), v: 3 });
    await a.sync();
    await b.sync();

    const server = await serverDocs();
    expect(server["tree:1"]).toEqual({ v: 3 });
    expect(server["tree:y"]).toEqual({ v: "user" });
  });

  it("uploads documents created while read-only once the account can write", async () => {
    let email = READER;
    const b = flexible((path, init) => apiAs(email)(path, init));
    await b.sync();
    await b.db.put({ _id: "tree:mine", v: 1 });
    await b.sync();
    expect(await serverDocs()).toEqual({});
    expect(bodyOf(await b.db.get("tree:mine"))).toEqual({ v: 1 }); // kept, not discarded

    email = EDITOR;
    await b.sync();
    expect(await serverDocs()).toEqual({ "tree:mine": { v: 1 } });
  });

  it("restores the server's data on a read-only device after a local wipe or edit", async () => {
    const a = device(EDITOR);
    await a.db.bulkDocs([
      { _id: "tree:1", v: 1 },
      { _id: "tree:2", v: 1 },
    ]);
    await a.sync();
    const b = device(READER);
    await b.sync();

    // What a "replace" backup import does: tombstone everything, then restore.
    const all = await b.db.allDocs();
    await b.db.bulkDocs(
      all.rows.map((r) => ({ _id: r.id, _rev: r.value.rev, _deleted: true }))
    );
    await b.db.put({ _id: "tree:1", v: "from old backup" });
    await b.sync();

    expect(bodyOf(await b.db.get("tree:1"))).toEqual({ v: 1 });
    expect(bodyOf(await b.db.get("tree:2"))).toEqual({ v: 1 });
    expect(posts()).toBe(1); // only the editor's original upload
  });
});

describe("interrupted cycles", () => {
  // An editor device whose upload reaches the server but whose response is lost.
  function withLostResponses() {
    const online = apiAs(EDITOR);
    const control = { drop: true };
    const db = new PouchDB(`device-${++deviceCounter}`, { adapter: "memory" });
    devices.push(db);
    const fetchImpl = async (path, init) => {
      const res = await online(path, init);
      if (init?.method === "POST" && control.drop) throw new TypeError("network");
      return res;
    };
    return { db, control, sync: createSync({ db, fetchImpl }).syncOnce };
  }

  it("keeps a later edit when the upload's response was lost", async () => {
    const a = withLostResponses();
    await a.db.put({ _id: "tree:1", v: 1 });
    expect((await a.sync()).state).toBe("offline");
    expect((await serverDocs())["tree:1"]).toEqual({ v: 1 }); // the server did apply it

    await a.db.put({ ...(await a.db.get("tree:1")), v: 2 });
    a.control.drop = false;
    expect((await a.sync()).state).toBe("idle");
    expect(bodyOf(await a.db.get("tree:1"))).toEqual({ v: 2 });
    expect((await serverDocs())["tree:1"]).toEqual({ v: 2 });
  });

  it("keeps a later delete when the upload's response was lost", async () => {
    const a = withLostResponses();
    await a.db.put({ _id: "tree:1", v: 1 });
    await a.sync();

    await a.db.remove(await a.db.get("tree:1"));
    a.control.drop = false;
    await a.sync();
    await expect(a.db.get("tree:1")).rejects.toMatchObject({ status: 404 });
    expect((await serverDocs())["tree:1"]).toBe("deleted");
  });

  it("does not push back a pulled version whose bookkeeping was lost in a crash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = device(EDITOR);
    await a.db.put({ _id: "tree:1", v: 1 });
    await a.sync();
    const b = device(EDITOR);
    await b.sync();
    await a.db.put({ ...(await a.db.get("tree:1")), v: 2 });
    await a.sync();

    // b writes v2 locally, then dies before it can record having done so.
    const realPut = b.db.put.bind(b.db);
    let wroteDoc = false;
    let crashed = false;
    b.db.put = (doc, ...rest) => {
      if (doc._id === "tree:1") wroteDoc = true;
      if (wroteDoc && !crashed && doc._id === "_local/sync") {
        return Promise.reject(new Error("crash"));
      }
      return realPut(doc, ...rest);
    };
    expect((await b.sync()).state).toBe("error");
    expect(bodyOf(await b.db.get("tree:1"))).toEqual({ v: 2 });
    crashed = true;

    await a.db.put({ ...(await a.db.get("tree:1")), v: 3 });
    await a.sync();
    await b.sync();
    expect((await serverDocs())["tree:1"]).toEqual({ v: 3 });
    expect(bodyOf(await b.db.get("tree:1"))).toEqual({ v: 3 });
  });
});

describe("failure states", () => {
  const failing = (fetchImpl) => {
    const db = new PouchDB(`device-${++deviceCounter}`, { adapter: "memory" });
    devices.push(db);
    return { db, sync: createSync({ db, fetchImpl }).syncOnce };
  };

  it("reports offline when the network is unreachable, and recovers", async () => {
    let down = true;
    const online = apiAs(EDITOR);
    const a = failing((...args) =>
      down ? Promise.reject(new TypeError("fetch")) : online(...args)
    );
    await a.db.put({ _id: "tree:1", commonName: "Fig" });

    expect((await a.sync()).state).toBe("offline");
    down = false;
    expect((await a.sync()).state).toBe("idle");
    expect(Object.keys(await serverDocs())).toEqual(["tree:1"]);
  });

  it("reports signed-out on a login redirect or a 401", async () => {
    const redirected = failing(async () => ({
      type: "opaqueredirect",
      status: 0,
      ok: false,
    }));
    expect((await redirected.sync()).state).toBe("signed-out");

    const anonymous = failing(apiAs("")); // no identity at all
    expect((await anonymous.sync()).state).toBe("signed-out");
  });

  it("reports an error for an unexpected response instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = failing(async () => new Response("<!doctype html>", { status: 200 }));
    expect((await html.sync()).state).toBe("error");

    const broken = failing(async () => new Response("{}", { status: 500 }));
    expect((await broken.sync()).state).toBe("error");
  });

  it("reports a document too large to sync, still syncs the rest, and recovers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = device(EDITOR);
    await a.db.bulkDocs([
      { _id: "tree:big", notes: "x".repeat(100_001) },
      { _id: "tree:1", commonName: "Fig" },
    ]);
    expect((await a.sync()).state).toBe("error");
    expect(Object.keys(await serverDocs())).toEqual(["tree:1"]);

    await a.db.put({ ...(await a.db.get("tree:big")), notes: "trimmed" });
    expect((await a.sync()).state).toBe("idle");
    expect((await serverDocs())["tree:big"]).toEqual({ notes: "trimmed" });
  });
});
