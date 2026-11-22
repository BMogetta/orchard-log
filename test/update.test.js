import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isUpdateAvailable,
  reloadToLatest,
  resetUpdateState,
  subscribeUpdateAvailable,
  watchForUpdates,
} from "../src/lib/update.js";

// Reloading into the newest build: the service worker has to be updated first,
// or the reload is answered with the old cached app.

function fakeWorker(state) {
  const listeners = [];
  return {
    state,
    addEventListener: (_type, fn) => listeners.push(fn),
    become(next) {
      this.state = next;
      for (const fn of listeners) fn();
    },
  };
}

function stubServiceWorker(registration) {
  vi.stubGlobal("navigator", {
    serviceWorker: { getRegistration: async () => registration },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("reloadToLatest", () => {
  it("waits for the new service worker to take over before reloading", async () => {
    const worker = fakeWorker("installing");
    const update = vi.fn(async () => {});
    stubServiceWorker({ update, installing: worker, waiting: null });
    const reload = vi.fn();

    const done = reloadToLatest({ reload });
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();

    worker.become("installed");
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();

    worker.become("activated");
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads right away when there is nothing new to install", async () => {
    stubServiceWorker({ update: async () => {}, installing: null, waiting: null });
    const reload = vi.fn();
    await reloadToLatest({ reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads anyway when the update check fails or there is no service worker", async () => {
    const reload = vi.fn();
    stubServiceWorker({
      update: async () => {
        throw new Error("offline");
      },
    });
    await reloadToLatest({ reload });

    vi.stubGlobal("navigator", {});
    await reloadToLatest({ reload });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not wait forever for a worker that never activates", async () => {
    vi.useFakeTimers();
    stubServiceWorker({
      update: async () => {},
      installing: fakeWorker("installing"),
      waiting: null,
    });
    const reload = vi.fn();

    const done = reloadToLatest({ reload });
    await vi.advanceTimersByTimeAsync(8000);
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("watchForUpdates", () => {
  // Enough of a service worker container and a document to drive the watcher.
  function fakes({ controller = {}, visible = true } = {}) {
    const update = vi.fn(async () => {});
    const serviceWorker = Object.assign(new EventTarget(), {
      controller,
      getRegistration: vi.fn(async () => ({ update })),
    });
    const doc = Object.assign(new EventTarget(), {
      visibilityState: visible ? "visible" : "hidden",
    });
    return { serviceWorker, doc, update };
  }
  const controllerChange = (sw) => sw.dispatchEvent(new Event("controllerchange"));

  let stop;
  afterEach(() => {
    stop?.();
    stop = null;
    resetUpdateState();
  });

  it("offers a reload when a new worker replaces the one in control", () => {
    const { serviceWorker, doc } = fakes();
    const seen = vi.fn();
    const unsubscribe = subscribeUpdateAvailable(seen);
    stop = watchForUpdates({ serviceWorker, doc });
    expect(isUpdateAvailable()).toBe(false);

    controllerChange(serviceWorker);
    expect(isUpdateAvailable()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);

    controllerChange(serviceWorker); // a second update while the tab stays open
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not mistake the first install for an update", () => {
    const { serviceWorker, doc } = fakes({ controller: null });
    stop = watchForUpdates({ serviceWorker, doc });

    controllerChange(serviceWorker); // the first worker taking control
    expect(isUpdateAvailable()).toBe(false);

    controllerChange(serviceWorker); // a later one replacing it
    expect(isUpdateAvailable()).toBe(true);
  });

  it("looks for a new worker when the app comes back into view, not while hidden", async () => {
    const { serviceWorker, doc, update } = fakes({ visible: false });
    stop = watchForUpdates({ serviceWorker, doc });

    doc.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();

    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it("checks again now and then while the app stays open and visible", async () => {
    vi.useFakeTimers();
    const { serviceWorker, doc, update } = fakes();
    const twoMinutes = 2 * 60 * 1000;
    stop = watchForUpdates({ serviceWorker, doc, intervalMs: twoMinutes });

    await vi.advanceTimersByTimeAsync(3 * twoMinutes);
    expect(update).toHaveBeenCalledTimes(3);

    doc.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(3 * twoMinutes);
    expect(update).toHaveBeenCalledTimes(3); // nothing while hidden
  });

  it("does not check on every switch back to the app", async () => {
    vi.useFakeTimers();
    const { serviceWorker, doc, update } = fakes();
    stop = watchForUpdates({ serviceWorker, doc });

    for (let i = 0; i < 5; i++) doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10);
    expect(update).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(61_000);
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("stops checking once stopped", async () => {
    vi.useFakeTimers();
    const { serviceWorker, doc, update } = fakes();
    watchForUpdates({ serviceWorker, doc, intervalMs: 120_000 })();

    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(update).not.toHaveBeenCalled();
  });

  it("survives a failed check and stops cleanly", async () => {
    const { serviceWorker, doc } = fakes();
    serviceWorker.getRegistration = vi.fn(async () => {
      throw new Error("offline");
    });
    stop = watchForUpdates({ serviceWorker, doc });
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(serviceWorker.getRegistration).toHaveBeenCalled());

    stop();
    stop = null;
    controllerChange(serviceWorker);
    expect(isUpdateAvailable()).toBe(false);
  });

  it("does nothing where there is no service worker", () => {
    expect(() => watchForUpdates({ serviceWorker: undefined })()).not.toThrow();
  });
});
