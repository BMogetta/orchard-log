import { describe, it, expect, afterEach, vi } from "vitest";
import { reloadToLatest } from "../src/lib/update.js";

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
