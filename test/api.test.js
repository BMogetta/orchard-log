// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import { onRequestGet as getMe } from "../functions/api/me.js";
import { onRequestGet as getChanges } from "../functions/api/changes.js";
import { onRequestPost as postDocs } from "../functions/api/docs.js";
import { readChanges, writeDocs, canonicalBody } from "../server/store.js";

// Coverage for the sync API: the real route handlers and middleware, run
// against a real local D1 (wrangler's platform proxy, nothing persisted) and
// real RS256 tokens verified against a stubbed Access certs endpoint.

const TEAM = "team.cloudflareaccess.example";
const AUD = "aud-tag-for-tests";
const EDITOR = "editor@example.com";
const READER = "reader@example.com";
const SITE = "https://orchard.example.com";

let platform;
let db;
let signer; // key pair whose public half the certs endpoint serves
let stranger; // key pair the certs endpoint has never heard of
let publishedKeys; // what the stubbed certs endpoint currently serves
let certsDown = false;

const b64url = (input) =>
  Buffer.from(typeof input === "string" ? input : new Uint8Array(input)).toString(
    "base64url"
  );

async function makeKeyPair() {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
}

async function token(claims = {}, { key = signer.privateKey, header = {} } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", kid: "test-key", ...header }));
  const body = b64url(
    JSON.stringify({
      aud: [AUD],
      iss: `https://${TEAM}`,
      exp: now + 600,
      email: EDITOR,
      ...claims,
    })
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${head}.${body}`)
  );
  return `${head}.${body}.${b64url(sig)}`;
}

const env = (extra = {}) => ({
  DB: db,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  EDITOR_EMAIL: EDITOR,
  ...extra,
});

// Run a route the way Pages does: middleware first, then the handler.
async function call(
  handler,
  path,
  { jwt, method = "GET", body, headers = {}, envExtra } = {}
) {
  const request = new Request(path.startsWith("http") ? path : `${SITE}${path}`, {
    method,
    headers: {
      ...(jwt ? { "cf-access-jwt-assertion": jwt } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
  const context = { request, env: env(envExtra), data: {} };
  context.next = () => handler(context);
  const res = await middleware(context);
  return { status: res.status, body: await res.json() };
}

const push = (docs, opts = {}) =>
  call(postDocs, "/api/docs", { method: "POST", body: { docs }, ...opts });

beforeAll(async () => {
  platform = await getPlatformProxy({ persist: false });
  db = platform.env.DB;
  const schema = readFileSync(
    new URL("../migrations/0001_init.sql", import.meta.url),
    "utf8"
  );
  const statements = schema
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of statements) await db.prepare(sql).run();

  signer = await makeKeyPair();
  stranger = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey("jwk", signer.publicKey);
  publishedKeys = [{ ...jwk, kid: "test-key" }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url) !== `https://${TEAM}/cdn-cgi/access/certs`) {
        throw new Error(`unexpected fetch: ${url}`);
      }
      if (certsDown) throw new Error("certs endpoint unreachable");
      return new Response(JSON.stringify({ keys: publishedKeys }));
    })
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await platform?.dispose();
});

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM docs"),
    db.prepare("UPDATE meta SET value = 0 WHERE key = 'seq'"),
  ]);
});

describe("authentication", () => {
  it("rejects a request with no Access token", async () => {
    expect((await call(getMe, "/api/me")).status).toBe(401);
  });

  it("identifies the editor and a reader from a valid token", async () => {
    const editor = await call(getMe, "/api/me", { jwt: await token() });
    expect(editor).toEqual({ status: 200, body: { email: EDITOR, role: "editor" } });

    const reader = await call(getMe, "/api/me", { jwt: await token({ email: READER }) });
    expect(reader).toEqual({ status: 200, body: { email: READER, role: "reader" } });
  });

  it("matches the editor email case-insensitively", async () => {
    const res = await call(getMe, "/api/me", {
      jwt: await token({ email: "Editor@Example.com" }),
    });
    expect(res.body.role).toBe("editor");
  });

  it("rejects a token signed by a key Access does not publish", async () => {
    const jwt = await token({}, { key: stranger.privateKey });
    expect((await call(getMe, "/api/me", { jwt })).status).toBe(401);
  });

  it("rejects a token whose payload was altered after signing", async () => {
    const [head, , sig] = (await token({ email: READER })).split(".");
    const now = Math.floor(Date.now() / 1000);
    const forged = b64url(
      JSON.stringify({
        aud: [AUD],
        iss: `https://${TEAM}`,
        exp: now + 600,
        email: EDITOR,
      })
    );
    expect(
      (await call(getMe, "/api/me", { jwt: `${head}.${forged}.${sig}` })).status
    ).toBe(401);
  });

  it.each([
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 10 }],
    ["a token for another application", { aud: ["someone-else"] }],
    ["a token from another issuer", { iss: "https://evil.example" }],
    ["a token with no email (service token)", { email: undefined }],
  ])("rejects %s", async (_label, claims) => {
    expect((await call(getMe, "/api/me", { jwt: await token(claims) })).status).toBe(401);
  });

  it("rejects unsigned and non-RS256 tokens", async () => {
    const none = await token({}, { header: { alg: "none" } });
    expect((await call(getMe, "/api/me", { jwt: none })).status).toBe(401);
    expect((await call(getMe, "/api/me", { jwt: "not-a-jwt" })).status).toBe(401);
  });

  it("rejects a token whose header or payload is not a JSON object", async () => {
    const [head, body, sig] = (await token()).split(".");
    expect(
      (await call(getMe, "/api/me", { jwt: `${b64url("null")}.${body}.${sig}` })).status
    ).toBe(401);
    expect(
      (await call(getMe, "/api/me", { jwt: `${head}.${b64url("[]")}.${sig}` })).status
    ).toBe(401);
  });

  it("rejects a token that is not valid yet", async () => {
    const nbf = Math.floor(Date.now() / 1000) + 600;
    expect((await call(getMe, "/api/me", { jwt: await token({ nbf }) })).status).toBe(
      401
    );
  });

  it("fails closed when the Access settings are missing", async () => {
    const res = await call(getMe, "/api/me", {
      jwt: await token(),
      envExtra: { ACCESS_AUD: "" },
    });
    expect(res.status).toBe(401);
  });

  it("treats everyone as a reader when no editor is configured", async () => {
    const res = await call(getMe, "/api/me", {
      jwt: await token(),
      envExtra: { EDITOR_EMAIL: "" },
    });
    expect(res.body.role).toBe("reader");
  });

  it("honours DEV_USER_EMAIL on localhost only", async () => {
    const envExtra = { DEV_USER_EMAIL: EDITOR };
    const local = await call(getMe, "http://localhost:8788/api/me", { envExtra });
    expect(local).toEqual({ status: 200, body: { email: EDITOR, role: "editor" } });

    const deployed = await call(getMe, "/api/me", { envExtra });
    expect(deployed.status).toBe(401);
  });
});

describe("POST /api/docs", () => {
  it("lets the editor write and assigns increasing seqs", async () => {
    const jwt = await token();
    const res = await push(
      [
        { id: "tree:a", doc: { commonName: "Meyer Lemon" } },
        { id: "event:b", doc: { treeId: "tree:a", type: "note" } },
      ],
      { jwt }
    );
    expect(res).toEqual({ status: 200, body: { written: 2 } });

    const { docs, lastSeq, more } = await readChanges(db, 0);
    expect(docs.map((d) => [d.id, d.seq])).toEqual([
      ["tree:a", 1],
      ["event:b", 2],
    ]);
    expect(docs[0].doc).toEqual({ commonName: "Meyer Lemon" });
    expect(lastSeq).toBe(2);
    expect(more).toBe(false);
  });

  it("refuses writes from a reader and leaves the store untouched", async () => {
    const res = await push([{ id: "tree:a", doc: { commonName: "Nope" } }], {
      jwt: await token({ email: READER }),
    });
    expect(res.status).toBe(403);
    expect((await readChanges(db, 0)).docs).toEqual([]);
  });

  it("refuses writes without a token", async () => {
    expect((await push([{ id: "tree:a", doc: {} }])).status).toBe(401);
  });

  it("refuses cross-origin and non-JSON writes", async () => {
    const jwt = await token();
    const docs = [{ id: "tree:a", doc: { commonName: "x" } }];

    const crossSite = await push(docs, {
      jwt,
      headers: { origin: "https://evil.example" },
    });
    expect(crossSite.status).toBe(403);

    const sameSite = await push(docs, { jwt, headers: { origin: SITE } });
    expect(sameSite.status).toBe(200);

    const textPlain = await push(docs, {
      jwt,
      headers: { "content-type": "text/plain" },
    });
    expect(textPlain.status).toBe(415);
  });

  it("skips a write identical to what is stored, whatever the key order", async () => {
    const jwt = await token();
    await push(
      [{ id: "tree:a", doc: { commonName: "Fig", pot: { size: 30, unit: "l" } } }],
      {
        jwt,
      }
    );
    const again = await push(
      [{ id: "tree:a", doc: { pot: { unit: "l", size: 30 }, commonName: "Fig" } }],
      { jwt }
    );
    expect(again.body.written).toBe(0);
    expect((await readChanges(db, 0)).docs.map((d) => d.seq)).toEqual([1]);
  });

  it("moves an updated doc to a new seq so other devices pull it again", async () => {
    const jwt = await token();
    await push(
      [
        { id: "tree:a", doc: { commonName: "Fig" } },
        { id: "tree:b", doc: { commonName: "Plum" } },
      ],
      { jwt }
    );
    await push([{ id: "tree:a", doc: { commonName: "Brown Turkey Fig" } }], { jwt });

    const after = await readChanges(db, 2);
    expect(after.docs).toHaveLength(1);
    expect(after.docs[0]).toMatchObject({
      id: "tree:a",
      doc: { commonName: "Brown Turkey Fig" },
    });
    expect(after.docs[0].seq).toBeGreaterThan(2);
  });

  it("records a deletion as a tombstone that propagates", async () => {
    const jwt = await token();
    await push([{ id: "tree:a", doc: { commonName: "Fig" } }], { jwt });
    const del = await push([{ id: "tree:a", deleted: true }], { jwt });
    expect(del.body.written).toBe(1);

    const { docs } = await readChanges(db, 1);
    expect(docs).toEqual([
      { id: "tree:a", seq: expect.any(Number), deleted: true, doc: null },
    ]);
  });

  it("drops local bookkeeping fields before storing", async () => {
    await push(
      [
        {
          id: "tree:a",
          doc: { _id: "tree:a", _rev: "3-abc", _attachments: {}, commonName: "Fig" },
        },
      ],
      { jwt: await token() }
    );
    expect((await readChanges(db, 0)).docs[0].doc).toEqual({ commonName: "Fig" });
  });

  it("rejects the whole batch when any entry is invalid", async () => {
    const jwt = await token();
    const good = { id: "tree:a", doc: { commonName: "Fig" } };
    for (const bad of [
      { id: "photo:p1", doc: {} }, // photos do not sync
      { id: "_design/x", doc: {} },
      { id: "tree:", doc: {} },
      { id: "tree:a b", doc: {} },
      { id: "tree:c" }, // no doc and not a deletion
      { id: "tree:c", doc: [] },
      "tree:c",
    ]) {
      expect((await push([good, bad], { jwt })).status).toBe(400);
    }
    expect((await readChanges(db, 0)).docs).toEqual([]);
  });

  it("stores a nested __proto__ key as data and rejects absurdly deep docs", async () => {
    const jwt = await token();
    const raw = (body) => call(postDocs, "/api/docs", { method: "POST", jwt, body });

    await raw('{"docs":[{"id":"tree:a","doc":{"a":{"__proto__":{"x":1},"b":2}}}]}');
    const stored = (await readChanges(db, 0)).docs[0].doc;
    expect(JSON.stringify(stored)).toBe('{"a":{"__proto__":{"x":1},"b":2}}');

    const deep = `${'{"k":'.repeat(40)}1${"}".repeat(40)}`;
    const res = await raw(`{"docs":[{"id":"tree:deep","doc":${deep}}]}`);
    expect(res.status).toBe(400);
  });

  it("treats a repeated delete as a no-op and the last duplicate id as the winner", async () => {
    const jwt = await token();
    await push(
      [
        { id: "tree:a", doc: { v: 1 } },
        { id: "tree:a", doc: { v: 2 } },
      ],
      { jwt }
    );
    expect((await readChanges(db, 0)).docs.map((d) => d.doc)).toEqual([{ v: 2 }]);

    await push([{ id: "tree:a", deleted: true }], { jwt });
    const again = await push([{ id: "tree:a", deleted: true }], { jwt });
    expect(again.body.written).toBe(0);
  });

  it("rejects a request body over the size cap", async () => {
    const jwt = await token();
    const big = JSON.stringify({ docs: [], pad: "x".repeat(2_000_001) });
    const res = await call(postDocs, "/api/docs", { method: "POST", jwt, body: big });
    expect(res.status).toBe(413);
  });

  it("rejects malformed bodies, oversized docs and oversized batches", async () => {
    const jwt = await token();
    const raw = (body) => call(postDocs, "/api/docs", { method: "POST", jwt, body });

    expect((await raw("{not json")).status).toBe(400);
    expect((await raw({ nope: true })).status).toBe(400);

    const huge = await push([{ id: "tree:a", doc: { notes: "x".repeat(100_001) } }], {
      jwt,
    });
    expect(huge.status).toBe(413);

    const many = Array.from({ length: 101 }, (_, i) => ({ id: `tree:${i}`, doc: {} }));
    expect((await push(many, { jwt })).status).toBe(413);

    expect((await push([], { jwt })).body).toEqual({ written: 0 });
  });
});

describe("GET /api/changes", () => {
  it("lets a reader pull everything, then only what changed since", async () => {
    await push(
      [
        { id: "tree:a", doc: { commonName: "Fig" } },
        { id: "settings:zones", doc: { zones: ["north wall"] } },
      ],
      { jwt: await token() }
    );
    const reader = await token({ email: READER });

    const first = await call(getChanges, "/api/changes", { jwt: reader });
    expect(first.status).toBe(200);
    expect(first.body.docs.map((d) => d.id)).toEqual(["tree:a", "settings:zones"]);
    expect(first.body.lastSeq).toBe(2);

    const caughtUp = await call(getChanges, "/api/changes?since=2", { jwt: reader });
    expect(caughtUp.body).toEqual({ docs: [], lastSeq: 2, more: false });
  });

  it("requires a token and a well-formed since", async () => {
    expect((await call(getChanges, "/api/changes")).status).toBe(401);
    const jwt = await token();
    for (const since of ["-1", "abc", "1.5", ""]) {
      expect(
        (await call(getChanges, `/api/changes?since=${since}`, { jwt })).status
      ).toBe(400);
    }
  });

  it("cuts a page short when the documents are large, and still makes progress", async () => {
    const jwt = await token();
    const docs = Array.from({ length: 15 }, (_, i) => ({
      id: `tree:${i}`,
      doc: { notes: String(i).padStart(2, "0") + "x".repeat(90_000) },
    }));
    await push(docs, { jwt });

    const first = await call(getChanges, "/api/changes", { jwt });
    expect(first.body.more).toBe(true);
    expect(first.body.docs.length).toBeLessThan(15);

    const rest = await call(getChanges, `/api/changes?since=${first.body.lastSeq}`, {
      jwt,
    });
    expect(rest.body.more).toBe(false);
    expect([...first.body.docs, ...rest.body.docs].map((d) => d.id)).toEqual(
      docs.map((d) => d.id)
    );
  });

  it("pages through a backlog without skipping or repeating docs", async () => {
    const docs = Array.from({ length: 7 }, (_, i) => ({
      id: `tree:${i}`,
      deleted: false,
      body: canonicalBody({ n: i }),
    }));
    await writeDocs(db, docs, EDITOR);

    const seen = [];
    let since = 0;
    for (;;) {
      const page = await readChanges(db, since, 3);
      seen.push(...page.docs.map((d) => d.id));
      since = page.lastSeq;
      if (!page.more) break;
    }
    expect(seen).toEqual(docs.map((d) => d.id));
  });
});

// Last on purpose: these move the clock and change what the certs endpoint
// serves, and the key cache is module state shared with the tests above.
describe("signing key cache", () => {
  const HOUR = 60 * 60 * 1000;

  afterAll(() => {
    vi.useRealTimers();
    certsDown = false;
  });

  it("keeps serving cached keys while the certs endpoint is down", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * HOUR); // past the cache TTL
    certsDown = true;

    const res = await call(getMe, "/api/me", { jwt: await token() });
    expect(res.status).toBe(200);
  });

  it("picks up a rotated key, but not before the refetch floor has passed", async () => {
    const jwk = await crypto.subtle.exportKey("jwk", stranger.publicKey);
    publishedKeys = [...publishedKeys, { ...jwk, kid: "rotated" }];
    certsDown = false;
    const rotated = () =>
      token({}, { key: stranger.privateKey, header: { kid: "rotated" } });

    // The failed attempt in the previous test was moments ago.
    expect((await call(getMe, "/api/me", { jwt: await rotated() })).status).toBe(401);

    vi.setSystemTime(Date.now() + 61_000);
    expect((await call(getMe, "/api/me", { jwt: await rotated() })).status).toBe(200);
    // The old key is still published, so existing sessions keep working.
    expect((await call(getMe, "/api/me", { jwt: await token() })).status).toBe(200);
  });
});
