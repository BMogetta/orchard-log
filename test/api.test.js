// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import { onRequestGet as getMe } from "../functions/api/me.js";
import { onRequestGet as getChanges } from "../functions/api/changes.js";
import { onRequestPost as postDocs } from "../functions/api/docs.js";
import {
  onRequestGet as getPhotoRoute,
  onRequestPut as putPhotoRoute,
} from "../functions/api/photos/[name].js";
import { onRequestGet as getLogin } from "../functions/api/login.js";
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
let bucket;
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
  PHOTOS: bucket,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  EDITOR_EMAIL: EDITOR,
  ...extra,
});

// Run a route the way Pages does: middleware first, then the handler.
// A header set to undefined is left out (a Request would send "undefined").
const withoutUndefined = (headers) =>
  Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined));

// `raw` sends the body as given (image bytes) instead of as JSON.
async function call(
  handler,
  path,
  { jwt, method = "GET", body, headers = {}, envExtra, params = {}, raw = false } = {}
) {
  const request = new Request(path.startsWith("http") ? path : `${SITE}${path}`, {
    method,
    headers: withoutUndefined({
      "x-orchard-sync": "2", // the app always sends its sync contract version
      ...(jwt ? { "cf-access-jwt-assertion": jwt } : {}),
      ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}),
      ...headers,
    }),
    body:
      body === undefined || raw || typeof body === "string" ? body : JSON.stringify(body),
  });
  const context = { request, env: env(envExtra), data: {}, params };
  context.next = () => handler(context);
  const res = await middleware(context);
  if (res.headers.get("content-type")?.startsWith("image/")) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, bytes };
  }
  return { status: res.status, body: await res.json() };
}

const push = (docs, opts = {}) =>
  call(postDocs, "/api/docs", { method: "POST", body: { docs }, ...opts });

beforeAll(async () => {
  platform = await getPlatformProxy({ persist: false });
  db = platform.env.DB;
  bucket = platform.env.PHOTOS;
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
  const { objects } = await bucket.list();
  if (objects.length) await bucket.delete(objects.map((o) => o.key));
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

describe("app version", () => {
  it("refuses an app build older than the sync contract, on every data route", async () => {
    const jwt = await token();
    const routes = [
      [getMe, "/api/me", {}],
      [getChanges, "/api/changes", {}],
      [postDocs, "/api/docs", { method: "POST", body: { docs: [] } }],
    ];
    for (const version of [undefined, "1", "abc", "", "2abc", "1, 2"]) {
      for (const [handler, path, opts] of routes) {
        const res = await call(handler, path, {
          jwt,
          ...opts,
          headers: { "x-orchard-sync": version },
        });
        expect(res.status, `${path} with ${version}`).toBe(426);
      }
    }
    expect((await readChanges(db, 0)).docs).toEqual([]);
  });

  it("accepts the current version and newer ones", async () => {
    const jwt = await token();
    for (const version of ["2", "3"]) {
      const res = await call(getMe, "/api/me", {
        jwt,
        headers: { "x-orchard-sync": version },
      });
      expect(res.status).toBe(200);
    }
  });

  it("still answers 401, not 426, to a caller with no identity", async () => {
    const res = await call(getMe, "/api/me", {
      headers: { "x-orchard-sync": undefined },
    });
    expect(res.status).toBe(401);
  });

  it("lets the sign-in landing through, which is a plain navigation", async () => {
    const request = new Request(`${SITE}/api/login`, {
      headers: { "cf-access-jwt-assertion": await token() },
    });
    const context = { request, env: env(), data: {}, params: {} };
    context.next = () => getLogin(context);
    const res = await middleware(context);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${SITE}/`);
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
      { id: "photo:a:b", doc: {} }, // a photo id is a single path segment
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

  it("treats a repeated delete as a no-op", async () => {
    const jwt = await token();
    await push([{ id: "tree:a", doc: { v: 1 } }], { jwt });
    await push([{ id: "tree:a", deleted: true }], { jwt });
    const again = await push([{ id: "tree:a", deleted: true }], { jwt });
    expect(again.body.written).toBe(0);
  });

  it("rejects a batch that names the same document twice", async () => {
    const jwt = await token();
    const res = await push(
      [
        { id: "tree:a", doc: { v: 1 } },
        { id: "tree:a", doc: { v: 2 } },
      ],
      { jwt }
    );
    expect(res.status).toBe(400);
    expect((await readChanges(db, 0)).docs).toEqual([]);
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

describe("photos", () => {
  const ascii = (text) => [...text].map((c) => c.charCodeAt(0));
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
  ]);
  const WEBP = new Uint8Array([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP")]);
  const SVG = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
  );

  const upload = (name, bytes, opts = {}) =>
    call(putPhotoRoute, `/api/photos/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: bytes,
      raw: true,
      params: { name },
      headers: { "content-type": "image/jpeg" },
      ...opts,
    });
  const download = (name, opts = {}) =>
    call(getPhotoRoute, `/api/photos/${encodeURIComponent(name)}`, {
      params: { name },
      ...opts,
    });

  it("lets the editor upload an image and anyone signed in download it", async () => {
    const up = await upload("p1", JPEG, { jwt: await token() });
    expect(up).toEqual({
      status: 200,
      body: { id: "photo:p1", type: "image/jpeg", size: JPEG.length },
    });

    const down = await download("p1", { jwt: await token({ email: READER }) });
    expect(down.status).toBe(200);
    expect(down.bytes).toEqual(JPEG);
    expect(down.headers.get("content-type")).toBe("image/jpeg");
  });

  it("serves images so a browser can only treat them as images", async () => {
    await upload("p1", JPEG, { jwt: await token() });
    const { headers } = await download("p1", { jwt: await token() });
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("refuses uploads from a reader and from anyone without a token", async () => {
    expect(
      (await upload("p1", JPEG, { jwt: await token({ email: READER }) })).status
    ).toBe(403);
    expect((await upload("p1", JPEG)).status).toBe(401);
    expect((await download("p1")).status).toBe(401);
    expect((await bucket.list()).objects).toHaveLength(0);
  });

  it("refuses cross-origin uploads", async () => {
    const res = await upload("p1", JPEG, {
      jwt: await token(),
      headers: { "content-type": "image/jpeg", origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("takes the type from the bytes, not from the request", async () => {
    const jwt = await token();
    expect((await upload("png", PNG, { jwt })).body.type).toBe("image/png");
    expect((await upload("webp", WEBP, { jwt })).body.type).toBe("image/webp");
    expect((await download("png", { jwt })).headers.get("content-type")).toBe(
      "image/png"
    );
  });

  it("rejects anything that is not a raster image, whatever it claims to be", async () => {
    const jwt = await token();
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    for (const bytes of [SVG, html, new Uint8Array(0)]) {
      expect((await upload("p1", bytes, { jwt })).status).toBe(415);
    }
    expect((await bucket.list()).objects).toHaveLength(0);
  });

  it("rejects oversized images and malformed ids", async () => {
    const jwt = await token();
    const big = new Uint8Array(5_000_001);
    big.set(JPEG);
    expect((await upload("p1", big, { jwt })).status).toBe(413);

    const declared = await upload("p1", JPEG, {
      jwt,
      headers: { "content-type": "image/jpeg", "content-length": "5000001" },
    });
    expect(declared.status).toBe(413); // refused on the declared size alone

    for (const name of ["a:b", "a b", "a/b", ".", "..", ".hidden", "x".repeat(129), ""]) {
      expect((await upload(name, JPEG, { jwt })).status, name).toBe(400);
      expect((await download(name, { jwt })).status, name).toBe(400);
    }
  });

  it("answers 404 for an image that does not exist", async () => {
    expect((await download("nope", { jwt: await token() })).status).toBe(404);
  });

  it("refuses a photo document whose image was not uploaded", async () => {
    const jwt = await token();
    const doc = { id: "photo:p1", doc: { treeId: "tree:a" } };
    const res = await push([{ id: "tree:a", doc: { commonName: "Fig" } }, doc], { jwt });
    expect(res.status).toBe(409);
    expect((await readChanges(db, 0)).docs).toEqual([]);

    await upload("p1", JPEG, { jwt });
    expect((await push([doc], { jwt })).body).toEqual({ written: 1 });
  });

  it("keeps the image when a delete and a re-create of the photo arrive together", async () => {
    const jwt = await token();
    await upload("p1", JPEG, { jwt });
    const res = await push(
      [
        { id: "photo:p1", deleted: true },
        { id: "photo:p1", doc: { treeId: "tree:a" } },
      ],
      { jwt }
    );
    expect(res.status).toBe(400);
    expect((await download("p1", { jwt })).status).toBe(200);
  });

  it("does not let a reader delete an image through a document tombstone", async () => {
    const jwt = await token();
    await upload("p1", JPEG, { jwt });
    await push([{ id: "photo:p1", doc: { treeId: "tree:a" } }], { jwt });

    const res = await push([{ id: "photo:p1", deleted: true }], {
      jwt: await token({ email: READER }),
    });
    expect(res.status).toBe(403);
    expect((await download("p1", { jwt })).status).toBe(200);
  });

  it("deletes the image when the photo document is deleted", async () => {
    const jwt = await token();
    await upload("p1", JPEG, { jwt });
    await upload("p2", JPEG, { jwt });
    await push(
      [
        { id: "photo:p1", doc: { treeId: "tree:a" } },
        { id: "photo:p2", doc: { treeId: "tree:a" } },
      ],
      { jwt }
    );

    await push([{ id: "photo:p1", deleted: true }], { jwt });
    expect((await download("p1", { jwt })).status).toBe(404);
    expect((await download("p2", { jwt })).status).toBe(200);
  });
});
