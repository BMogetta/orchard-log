import { authenticate } from "../../server/auth.js";
import { error } from "../../server/http.js";
import { PROTOCOL_HEADER, SYNC_PROTOCOL } from "../../shared/sync.js";

// Every /api route requires a verified identity; handlers read it from
// `context.data.user` and decide what that identity may do.
export async function onRequest(context) {
  const { request, env } = context;

  // The session rides on a cookie-backed Access login, so refuse writes that
  // originate from another site.
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin && origin !== new URL(request.url).origin) {
    return error(403, "cross-origin request");
  }

  const user = await authenticate(request, env);
  if (!user) return error(401, "unauthorized");

  // An app build older than the current sync contract must not sync: tell it
  // to update instead. The sign-in landing is a plain navigation, with no app
  // code behind it, so it is exempt.
  const isNavigation = new URL(request.url).pathname === "/api/login";
  if (!isNavigation && !(Number(request.headers.get(PROTOCOL_HEADER)) >= SYNC_PROTOCOL)) {
    return error(426, "app out of date");
  }

  context.data.user = user;
  return context.next();
}
