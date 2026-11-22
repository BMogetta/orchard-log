// Landing point for "sign in again". The app shell is served from the service
// worker cache, so reloading it never reaches Cloudflare Access once a session
// has expired. A top-level navigation here does: Access shows its login, then
// this sends the browser back to the app.
export function onRequestGet({ request }) {
  return Response.redirect(new URL("/", request.url).toString(), 302);
}
