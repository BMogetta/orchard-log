import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import React from "react";
import App from "../src/App.jsx";
import { I18nProvider } from "../src/lib/i18n.jsx";
import { resetDatabase } from "../src/data/backend.js";
import { trees } from "../src/data/repository.js";
import { blankTree } from "../src/data/model.js";

// jsdom's Blob/File lack arrayBuffer()/text(), which backup export/import and
// photo storage rely on. Node's implementations have them; use those globally.
globalThis.Blob = NodeBlob;
globalThis.File = NodeFile;

// End-to-end flow tests: render the real App against the real data layer (the
// in-memory PouchDB adapter) and drive it as a user would. These lock the
// critical journeys so a regression in wiring, reactivity or copy is caught.
//
// The camera path needs canvas/createImageBitmap, which jsdom lacks, so
// downscaleImage is replaced by a pass-through that yields a tiny JPEG blob.
vi.mock("../src/lib/image.js", () => ({
  downscaleImage: async () => new Blob(["img-bytes"], { type: "image/jpeg" }),
  blobUrl: () => "blob:mock",
}));

// vitest's jsdom doesn't expose localStorage as a global, and i18n reads it
// bare to pick the language (falling back to Spanish). Shim it so the app can
// be pinned to English for the assertions below.
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
}

function renderApp() {
  return render(
    <I18nProvider>
      <App />
    </I18nProvider>
  );
}

beforeEach(async () => {
  // Assert against the English copy so the test strings stay English too.
  localStorage.setItem("orchard-log:lang", "en");
  // Destructive confirms (delete, replace-on-import) auto-approve.
  vi.spyOn(window, "confirm").mockReturnValue(true);
  // jsdom has no object-URL support; photos and export use it.
  window.URL.createObjectURL = vi.fn(() => "blob:mock");
  window.URL.revokeObjectURL = vi.fn();
  // The export anchor's click() would trigger jsdom's unimplemented navigation.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await resetDatabase();
});

afterEach(() => {
  cleanup(); // unmount so screen queries don't see prior tests' DOM
  vi.restoreAllMocks();
});

describe("tree lifecycle", () => {
  it("creates a tree and shows it in the list and the spec-vs-observed detail", async () => {
    renderApp();

    fireEvent.click(await screen.findByText("Add tree"));
    fireEvent.change(await screen.findByLabelText("Common name"), {
      target: { value: "Meyer Lemon" },
    });
    fireEvent.click(screen.getByText("Save tree"));

    // Detail view: the signature side-by-side spec vs observed.
    expect(await screen.findByRole("heading", { name: "Meyer Lemon" })).toBeInTheDocument();
    expect(screen.getByText("Spec")).toBeInTheDocument();
    expect(screen.getByText("Observed")).toBeInTheDocument();

    fireEvent.click(screen.getByText("← All trees"));
    expect(await screen.findByText("Meyer Lemon")).toBeInTheDocument();
  });
});

describe("timeline events", () => {
  it("logs, edits and deletes a timeline event", async () => {
    await trees.save({ ...blankTree(), commonName: "Fig", label: "01" });
    renderApp();

    fireEvent.click(await screen.findByText("Fig"));
    fireEvent.change(await screen.findByPlaceholderText("Notes"), {
      target: { value: "Repotted into 20L" },
    });
    // getByRole avoids the wordmark's <span>Log</span> matching "Log".
    fireEvent.click(screen.getByRole("button", { name: "Log" }));

    // Edit the event in place (scope the ambiguous "Edit"/"Delete" to its row).
    const row = (await screen.findByText("Repotted into 20L")).closest("li");
    fireEvent.click(within(row).getByText("Edit"));
    fireEvent.change(screen.getByDisplayValue("Repotted into 20L"), {
      target: { value: "Repotted into 25L" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("Repotted into 25L")).toBeInTheDocument();

    const editedRow = screen.getByText("Repotted into 25L").closest("li");
    fireEvent.click(within(editedRow).getByText("Delete"));
    await waitFor(() => expect(screen.queryByText("Repotted into 25L")).toBeNull());
  });
});

describe("event photos", () => {
  it("adds a photo, opens it in the lightbox and deletes it", async () => {
    await trees.save({ ...blankTree(), commonName: "Olive" });
    const { container } = renderApp();

    fireEvent.click(await screen.findByText("Olive"));
    await screen.findByText("Clinical history");

    const fileInput = container.querySelector('input[type="file"][accept="image/*"]');
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] },
    });

    const thumb = await waitFor(() => {
      const el = container.querySelector("img.thumb");
      if (!el) throw new Error("thumbnail not rendered yet");
      return el;
    });

    fireEvent.click(thumb);
    const lightbox = container.querySelector(".lightbox");
    fireEvent.click(within(lightbox).getByText("Delete"));
    await waitFor(() => expect(container.querySelector("img.thumb")).toBeNull());
  });
});

describe("harvest tracking", () => {
  it("records harvest yield and shows per-year totals that sum", async () => {
    await trees.save({ ...blankTree(), commonName: "Vine" });
    const { container } = renderApp();

    fireEvent.click(await screen.findByText("Vine"));
    await screen.findByText("Clinical history");

    const logHarvest = (amount, date) => {
      fireEvent.change(container.querySelector(".log-form select"), {
        target: { value: "harvest" },
      });
      fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: amount } });
      fireEvent.change(screen.getByPlaceholderText("Unit (kg, pcs)"), {
        target: { value: "kg" },
      });
      fireEvent.change(container.querySelector('.log-form input[type="date"]'), {
        target: { value: date },
      });
      fireEvent.click(screen.getByRole("button", { name: "Log" }));
    };

    logHarvest("3", "2026-06-01");
    expect(await screen.findByText("Harvest")).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("3 kg")).toBeInTheDocument();

    logHarvest("2", "2026-07-01");
    expect(await screen.findByText("5 kg")).toBeInTheDocument();
  });
});

describe("needs-attention list", () => {
  it("surfaces an overdue care task and opens the tree from it", async () => {
    await trees.save({
      ...blankTree(),
      commonName: "Kumquat",
      careSchedule: [
        {
          task: "Water check",
          intervalDays: 7,
          intervalDaysSummer: null,
          intervalDaysWinter: null,
          lastDone: null, // never done -> overdue
        },
      ],
    });
    renderApp();

    const panel = (await screen.findByText("Needs attention")).closest("section");
    expect(within(panel).getByText("Kumquat")).toBeInTheDocument();

    fireEvent.click(within(panel).getByText("Water check"));
    expect(await screen.findByText("Clinical history")).toBeInTheDocument();
  });
});

describe("backup round-trip through the UI", () => {
  it("exports the database to a backup file", async () => {
    await trees.save({ ...blankTree(), commonName: "Backup Me" });
    const captured = [];
    window.URL.createObjectURL = vi.fn((blob) => (captured.push(blob), "blob:mock"));
    renderApp();

    fireEvent.click(await screen.findByText("Backup"));
    fireEvent.click(screen.getByText("Export backup"));

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const backup = JSON.parse(await captured[0].text());
    expect(backup.app).toBe("orchard-log");
    expect(backup.version).toBe(3);
    expect(backup.docs.some((d) => d.commonName === "Backup Me")).toBe(true);
  });

  it("imports a backup file and restores the trees", async () => {
    const { container } = renderApp();
    fireEvent.click(await screen.findByText("Backup"));

    const backup = {
      app: "orchard-log",
      version: 3,
      docs: [{ _id: "tree:imported", commonName: "Imported Fig", careSchedule: [] }],
    };
    const file = new File([JSON.stringify(backup)], "backup.json", {
      type: "application/json",
    });
    fireEvent.change(container.querySelector('input[type="file"][accept="application/json"]'), {
      target: { files: [file] },
    });

    expect(await screen.findByText("Restored.")).toBeInTheDocument();
    expect(await screen.findByText("Imported Fig")).toBeInTheDocument();
  });

  it("rejects a file that is not an Orchard Log backup", async () => {
    const { container } = renderApp();
    fireEvent.click(await screen.findByText("Backup"));

    const file = new File(['{"not":"ours"}'], "x.json", { type: "application/json" });
    fireEvent.change(container.querySelector('input[type="file"][accept="application/json"]'), {
      target: { files: [file] },
    });

    expect(await screen.findByText("This file is not an Orchard Log backup.")).toBeInTheDocument();
  });
});
