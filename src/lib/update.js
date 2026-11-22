// Reload into the newest build. A plain reload is answered by the service
// worker that is active right now, which may still hold the old app shell, so
// the reload would bring back the same old build. Ask the browser to fetch a
// new worker first and wait for it to take over. If any of that fails or takes
// too long, reload anyway: the update then lands in the background and the
// next reload picks it up.
const ACTIVATION_TIMEOUT_MS = 8000;

// `reload` is replaceable so the sequence can be tested.
export async function reloadToLatest({ reload = () => window.location.reload() } = {}) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.update();
      const worker = registration.installing ?? registration.waiting;
      if (worker && worker.state !== "activated") {
        await Promise.race([
          new Promise((resolve) => {
            worker.addEventListener("statechange", () => {
              if (worker.state === "activated" || worker.state === "redundant") resolve();
            });
          }),
          new Promise((resolve) => setTimeout(resolve, ACTIVATION_TIMEOUT_MS)),
        ]);
      }
    }
  } catch {
    // No service worker, or the update check failed (offline): just reload.
  }
  reload();
}
