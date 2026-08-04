// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import expressPouchDB from "express-pouchdb";
import PouchDB from "pouchdb-core";
import memAdapter from "pouchdb-adapter-memory";
import { resetDatabase } from "../src/data/backend.js";
import { trees } from "../src/data/repository.js";
import { startSync } from "../src/data/sync.js";

// End-to-end coverage for the optional CouchDB sync (Phase 3). Runs the app's
// real startSync() against an in-process CouchDB-compatible server
// (express-pouchdb, in memory) — no Docker required, so it runs anywhere the
// unit suite runs. backend.js + sync.js already register the memory, http and
// replication plugins on the shared pouchdb-core; the memory plugin below is a
// harmless re-registration in case import order ever changes.
PouchDB.plugin(memAdapter);
const ServerPouch = PouchDB.defaults({ adapter: "memory" });

let server;
let base;
let dbCounter = 0;
const handles = [];

// Each test syncs against a fresh remote database so leftovers can't leak.
const nextRemoteUrl = () => `${base}/orchard_${++dbCounter}`;
const track = (handle) => (handles.push(handle), handle);

// Poll until `fn` returns a truthy value (or throws until it does), so tests
// don't depend on replication timing.
async function until(fn, { timeout = 5000, interval = 25 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // keep polling — the doc may not have replicated yet
    }
    if (Date.now() - start > timeout) throw new Error("until: timed out");
    await new Promise((r) => setTimeout(r, interval));
  }
}

beforeAll(async () => {
  const app = express();
  app.use(
    "/db",
    expressPouchDB(ServerPouch, { mode: "minimumForPouchDB", configPath: "/dev/null" })
  );
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${server.address().port}/db`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

afterEach(async () => {
  while (handles.length) {
    try {
      handles.pop().cancel();
    } catch {
      // already finished
    }
  }
  await resetDatabase();
});

describe("CouchDB sync", () => {
  it("pushes a locally-created tree to the remote database", async () => {
    const url = nextRemoteUrl();
    const id = await trees.save({ commonName: "Meyer Lemon", careSchedule: [] });

    track(startSync(url));

    const remote = new PouchDB(url, { adapter: "http" });
    const doc = await until(() => remote.get(id));
    expect(doc.commonName).toBe("Meyer Lemon");
  });

  it("pulls a tree written directly on the remote into the local database", async () => {
    const url = nextRemoteUrl();
    const remote = new PouchDB(url, { adapter: "http" });
    await remote.put({ _id: "tree:pulled", commonName: "Remote Fig", careSchedule: [] });

    track(startSync(url));

    const local = await until(() => trees.get("tree:pulled"));
    expect(local.commonName).toBe("Remote Fig");
  });

  it("moves URL-embedded credentials into the auth option so requests still succeed", async () => {
    // A URL like http://user:pass@host makes fetch() throw "cannot be
    // constructed from a URL that includes credentials". sync.js strips the
    // credentials into PouchDB's `auth` option; if that regressed, replication
    // would never issue a request and this would time out. The server ignores
    // the credentials — the assertion is only that the doc still replicates.
    const plainUrl = nextRemoteUrl();
    const credentialedUrl = plainUrl.replace("http://", "http://user:secret@");
    const id = await trees.save({ commonName: "Auth Tree", careSchedule: [] });

    track(startSync(credentialedUrl));

    const remote = new PouchDB(plainUrl, { adapter: "http" });
    const doc = await until(() => remote.get(id));
    expect(doc.commonName).toBe("Auth Tree");
  });
});
