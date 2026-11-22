import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import React from "react";
import App from "../src/App.jsx";
import { I18nProvider } from "../src/lib/i18n.jsx";
import { resetDatabase } from "../src/data/backend.js";
import { trees, events } from "../src/data/repository.js";
import { blankTree } from "../src/data/model.js";

// What a device shows depending on what it is allowed to do. The sync status
// is replaced by a controllable stand-in; everything else is the real app on
// the real (in-memory) data layer.
const sync = vi.hoisted(() => {
  const listeners = new Set();
  const store = {
    status: { state: "off", role: null },
    set(next) {
      store.status = next;
      for (const listener of listeners) listener();
    },
    getSyncStatus: () => store.status,
    subscribeSyncStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
});

vi.mock("../src/data/sync.js", () => ({
  getSyncStatus: sync.getSyncStatus,
  subscribeSyncStatus: sync.subscribeSyncStatus,
}));

vi.mock("../src/lib/image.js", () => ({
  downscaleImage: async () => new Blob(["img-bytes"], { type: "image/jpeg" }),
  blobUrl: () => "blob:mock",
}));

if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
}

const WRITE_CONTROLS = [
  "Edit",
  "Delete",
  "Mark done today",
  "+ Photo",
  "Log",
  "Saw flower",
  "Saw fruit",
  "Harvested",
];

// Controls only: the wordmark also contains the text "Log", in a span.
const controls = (label) =>
  screen.queryAllByText(label).filter((el) => ["BUTTON", "LABEL"].includes(el.tagName));

async function openSeededTree() {
  const id = await trees.save({
    ...blankTree(),
    commonName: "Meyer Lemon",
    careSchedule: [{ task: "Water", intervalDays: 3, lastDone: null }],
  });
  await events.add({ treeId: id, type: "note", date: "2026-01-10", notes: "repotted" });
  render(
    <I18nProvider>
      <App />
    </I18nProvider>
  );
  // The tree also shows in the "needs attention" panel; open it from the list.
  const matches = await screen.findAllByText("Meyer Lemon");
  fireEvent.click(matches.at(-1));
  await screen.findByText("repotted");
}

beforeEach(async () => {
  localStorage.setItem("orchard-log:lang", "en");
  await resetDatabase();
});

afterEach(() => {
  cleanup();
  sync.set({ state: "off", role: null });
});

describe("a read-only device", () => {
  beforeEach(() => sync.set({ state: "idle", role: "reader" }));

  it("shows the data and the notice, and none of the controls that write", async () => {
    await openSeededTree();

    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    expect(screen.getByText("repotted")).toBeInTheDocument();
    expect(screen.getByText("Add to calendar")).toBeInTheDocument(); // not a write
    for (const label of WRITE_CONTROLS) {
      expect(controls(label), label).toHaveLength(0);
    }
    // Hidden file inputs are write paths too, even with no visible control.
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });

  it("hides adding trees, and keeps export without import", async () => {
    await openSeededTree();
    fireEvent.click(screen.getByText("← All trees"));

    expect(screen.queryByText("Add tree")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Backup"));
    expect(screen.getByText("Export backup")).toBeInTheDocument();
    expect(screen.queryByText("Import backup")).not.toBeInTheDocument();
  });

  it("stays read-only while a sync attempt is failing", async () => {
    sync.set({ state: "offline", role: "reader" });
    await openSeededTree();
    expect(controls("Edit")).toHaveLength(0);
  });

  it("drops out of the edit form when the device turns read-only", async () => {
    sync.set({ state: "idle", role: "editor" });
    await openSeededTree();
    fireEvent.click(controls("Edit")[0]);
    expect(await screen.findByText("Save tree")).toBeInTheDocument();

    act(() => sync.set({ state: "idle", role: "reader" }));
    expect(screen.queryByText("Save tree")).not.toBeInTheDocument();
    expect(await screen.findByText("repotted")).toBeInTheDocument();
    expect(controls("Edit")).toHaveLength(0);

    // Becoming an editor again does not reopen the form by itself.
    act(() => sync.set({ state: "idle", role: "editor" }));
    expect(screen.queryByText("Save tree")).not.toBeInTheDocument();
    expect(controls("Edit").length).toBeGreaterThan(0);
  });

  it("abandons an event edit in progress, and does not bring it back", async () => {
    sync.set({ state: "idle", role: "editor" });
    await openSeededTree();
    fireEvent.click(controls("Edit").at(-1)); // the event's own Edit
    expect(await screen.findByDisplayValue("repotted")).toBeInTheDocument();

    act(() => sync.set({ state: "idle", role: "reader" }));
    expect(screen.queryByDisplayValue("repotted")).not.toBeInTheDocument();
    act(() => sync.set({ state: "idle", role: "editor" }));
    expect(screen.queryByDisplayValue("repotted")).not.toBeInTheDocument();
    expect(screen.getByText("repotted")).toBeInTheDocument();
  });

  it("hides the controls on a first launch until the role is known", async () => {
    sync.set({ state: "syncing", role: null });
    await openSeededTree();
    expect(controls("Edit")).toHaveLength(0);
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });
});

describe("a device that may edit", () => {
  it.each([
    ["the signed-in editor", { state: "idle", role: "editor" }],
    ["a build without sync", { state: "off", role: null }],
    ["an editor whose session expired", { state: "signed-out", role: "editor" }],
    [
      "a device that could not learn its role because it is offline",
      { state: "offline", role: null },
    ],
  ])("shows the write controls for %s", async (_label, status) => {
    sync.set(status);
    await openSeededTree();
    for (const label of WRITE_CONTROLS) {
      expect(controls(label).length, label).toBeGreaterThan(0);
    }
  });
});
