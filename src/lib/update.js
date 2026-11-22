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

// --- Noticing a new build without being told ------------------------------
//
// A deploy does not reload open tabs. The service worker updates in the
// background and takes control of the page, but the page keeps running the
// JavaScript it loaded. Left alone, a tab finds out only when the API refuses
// it. So: ask the browser to look for a new worker whenever the app comes
// back into view (and now and then while it stays open), and when a new one
// takes control, say that a reload is available. The reload is offered, never
// forced: the user may be in the middle of typing.

const CHECK_EVERY_MS = 30 * 60 * 1000;
// Switching apps back and forth should not turn into a request each time.
const MIN_BETWEEN_CHECKS_MS = 60 * 1000;

let updateAvailable = false;
const listeners = new Set();

export const isUpdateAvailable = () => updateAvailable;

export function subscribeUpdateAvailable(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce() {
  if (updateAvailable) return;
  updateAvailable = true;
  for (const listener of listeners) listener();
}

// Starts watching. Returns a stop function. Does nothing where there is no
// service worker (the dev server, an unsupported browser).
export function watchForUpdates({
  serviceWorker = globalThis.navigator?.serviceWorker,
  doc = globalThis.document,
  intervalMs = CHECK_EVERY_MS,
} = {}) {
  if (!serviceWorker || !doc) return () => {};

  // The first worker a page ever gets also "takes control". That is an
  // install, not an update, so only a change from an existing controller counts.
  // The cost: a page with no controller (after a hard reload) does not notice
  // the next update. It is still covered by the API refusing old builds.
  let hadController = Boolean(serviceWorker.controller);
  const onControllerChange = () => {
    if (hadController) announce();
    hadController = true;
  };

  let lastCheck = -Infinity;
  const check = async () => {
    const now = Date.now();
    if (now - lastCheck < MIN_BETWEEN_CHECKS_MS) return;
    lastCheck = now;
    try {
      const registration = await serviceWorker.getRegistration();
      await registration?.update();
    } catch {
      // Offline, or the browser refused: try again on the next occasion.
    }
  };
  const onVisible = () => {
    if (doc.visibilityState === "visible") check();
  };

  serviceWorker.addEventListener("controllerchange", onControllerChange);
  doc.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(onVisible, intervalMs);

  return () => {
    serviceWorker.removeEventListener("controllerchange", onControllerChange);
    doc.removeEventListener("visibilitychange", onVisible);
    clearInterval(timer);
  };
}

// For tests.
export function resetUpdateState() {
  updateAvailable = false;
  for (const listener of listeners) listener();
}
