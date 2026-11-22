import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import React from "react";
import UpdateBanner from "../src/components/UpdateBanner.jsx";
import { I18nProvider } from "../src/lib/i18n.jsx";
import { resetUpdateState, watchForUpdates } from "../src/lib/update.js";

// The banner against the real update store: it has to appear by itself when a
// new service worker takes control of a page that is already open.

if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
}

let stop;
afterEach(() => {
  cleanup();
  stop?.();
  stop = null;
  resetUpdateState();
});

describe("UpdateBanner", () => {
  it("appears when a new worker takes over an open page", () => {
    localStorage.setItem("orchard-log:lang", "en");
    const serviceWorker = Object.assign(new EventTarget(), {
      controller: {},
      getRegistration: async () => undefined,
    });
    stop = watchForUpdates({ serviceWorker, doc: document });
    render(
      <I18nProvider>
        <UpdateBanner />
      </I18nProvider>
    );
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();

    act(() => {
      serviceWorker.dispatchEvent(new Event("controllerchange"));
    });
    expect(screen.getByText("There is a new version of the app.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
