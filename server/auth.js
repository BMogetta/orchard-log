// Identity for the sync API. Cloudflare Access sits in front of the site and
// adds a signed JWT (Cf-Access-Jwt-Assertion) to every request it lets through.
// The API verifies that token itself instead of trusting that Access is in
// front: the project's *.pages.dev hostname is reachable without Access, and
// there the header is absent or forgeable.

const JWKS_TTL_MS = 60 * 60 * 1000;
// Floor between refetches, so a stream of tokens with unknown key ids cannot
// turn every request into a fetch against the Access certs endpoint.
const JWKS_MIN_REFETCH_MS = 60 * 1000;
// team domain -> { keys: Map<kid, CryptoKey>, fetchedAt, attemptedAt }
const jwksCache = new Map();

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function b64urlToBytes(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const b64urlToJson = (text) => JSON.parse(new TextDecoder().decode(b64urlToBytes(text)));

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

async function fetchKeys(teamDomain) {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`access certs: HTTP ${res.status}`);
  const { keys = [] } = await res.json();
  const byKid = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
      byKid.set(jwk.kid, key);
    } catch {
      // One unusable key (e.g. not a signing key) must not discard the rest.
    }
  }
  return byKid;
}

// Access rotates its signing keys, so an unknown kid triggers a refetch before
// the token is rejected. If the certs endpoint is unreachable the previous keys
// keep being served: a blip there must not lock out valid sessions. Failed
// attempts count toward the refetch floor too.
async function signingKey(teamDomain, kid) {
  const now = Date.now();
  let entry = jwksCache.get(teamDomain);
  const wanted = !entry || now - entry.fetchedAt > JWKS_TTL_MS || !entry.keys.has(kid);
  if (wanted && (!entry || now - entry.attemptedAt > JWKS_MIN_REFETCH_MS)) {
    try {
      entry = { keys: await fetchKeys(teamDomain), fetchedAt: now, attemptedAt: now };
    } catch {
      entry = {
        keys: entry?.keys ?? new Map(),
        fetchedAt: entry?.fetchedAt ?? 0,
        attemptedAt: now,
      };
    }
    jwksCache.set(teamDomain, entry);
  }
  return entry.keys.get(kid) ?? null;
}

// Returns the verified token payload, or null for anything that is not a
// valid, unexpired Access token for this application.
export async function verifyAccessJwt(token, env) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (!teamDomain || !audience || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header, payload, signature;
  try {
    header = b64urlToJson(parts[0]);
    payload = b64urlToJson(parts[1]);
    signature = b64urlToBytes(parts[2]);
  } catch {
    return null; // not base64url / not JSON
  }
  if (!isObject(header) || !isObject(payload)) return null;
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const key = await signingKey(teamDomain, header.kid);
  if (!key) return null;

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;
  if (typeof payload.exp !== "number" || payload.exp <= now) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now) return null;
  return payload;
}

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

function userFor(email, env) {
  const editor = normalizeEmail(env.EDITOR_EMAIL);
  return { email, role: editor && email === editor ? "editor" : "reader" };
}

// Resolves the caller to { email, role } or null. Everyone Access lets in can
// read; only EDITOR_EMAIL can write.
export async function authenticate(request, env) {
  // Local development has no Access in front. DEV_USER_EMAIL (from .dev.vars)
  // stands in for the identity, and only when the request is served from
  // localhost, so the variable is inert if it ever reaches a deployed env.
  const devEmail = normalizeEmail(env.DEV_USER_EMAIL);
  if (devEmail && LOCAL_HOSTS.has(new URL(request.url).hostname)) {
    return userFor(devEmail, env);
  }

  const payload = await verifyAccessJwt(
    request.headers.get("cf-access-jwt-assertion"),
    env
  );
  // Service tokens carry no email; this API is for people only.
  const email = normalizeEmail(payload?.email);
  return email ? userFor(email, env) : null;
}
