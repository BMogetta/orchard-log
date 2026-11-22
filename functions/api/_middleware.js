import { authenticate } from "../../server/auth.js";
import { error } from "../../server/http.js";

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
  context.data.user = user;
  return context.next();
}
