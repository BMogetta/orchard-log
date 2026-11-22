import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import React from "react";
import App from "../src/App.jsx";
import { I18nProvider } from "../src/lib/i18n.jsx";
import { resetDatabase, pouch } from "../src/data/backend.js";
import { trees, events, photos } from "../src/data/repository.js";
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
const image = vi.hoisted(() => ({ fail: false, empty: false }));
vi.mock("../src/lib/image.js", () => ({
  downscaleImage: async () => {
    if (image.fail) throw new Error("cannot decode");
    if (image.empty) return null; // what canvas.toBlob yields when it cannot encode
    return new Blob(["img-bytes"], { type: "image/jpeg" });
  },
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

  it("records chill hours as a min–max range when required", async () => {
    renderApp();
    fireEvent.click(await screen.findByText("Add tree"));
    fireEvent.change(await screen.findByLabelText("Common name"), {
      target: { value: "Peach" },
    });
    // The hour range only appears once chill is marked as required.
    fireEvent.change(screen.getByLabelText(/Chill hours needed/), { target: { value: "yes" } });
    fireEvent.change(screen.getByPlaceholderText("min"), { target: { value: "300" } });
    fireEvent.change(screen.getByPlaceholderText("max"), { target: { value: "1000" } });
    fireEvent.click(screen.getByText("Save tree"));

    expect(await screen.findByRole("heading", { name: "Peach" })).toBeInTheDocument();
    expect(screen.getByText("300–1000")).toBeInTheDocument();
  });

  it("shows 'No' for chill hours when not required", async () => {
    renderApp();
    fireEvent.click(await screen.findByText("Add tree"));
    fireEvent.change(await screen.findByLabelText("Common name"), { target: { value: "Lime" } });
    fireEvent.change(screen.getByLabelText(/Chill hours needed/), { target: { value: "no" } });
    fireEvent.click(screen.getByText("Save tree"));

    expect(await screen.findByRole("heading", { name: "Lime" })).toBeInTheDocument();
    const line = screen.getByText("Chill hours").closest(".line");
    expect(within(line).getByText("No")).toBeInTheDocument();
  });

  it("records a partially self-fertile pollination", async () => {
    renderApp();
    fireEvent.click(await screen.findByText("Add tree"));
    fireEvent.change(await screen.findByLabelText("Common name"), {
      target: { value: "Plum" },
    });
    fireEvent.change(screen.getByLabelText("Pollination"), {
      target: { value: "partial-self" },
    });
    fireEvent.click(screen.getByText("Save tree"));

    expect(await screen.findByRole("heading", { name: "Plum" })).toBeInTheDocument();
    expect(screen.getByText(/partially self-fertile/)).toBeInTheDocument();
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

describe("build identification", () => {
  it("shows the running build in the Backup menu", async () => {
    renderApp();
    fireEvent.click(await screen.findByText("Backup"));
    // Tests run without the build-time values, so the fallback label shows.
    expect(screen.getByText("Version dev")).toBeInTheDocument();
  });
});

describe("picking a photo", () => {
  afterEach(() => {
    image.fail = false;
    image.empty = false;
  });

  it("lets the phone offer the gallery, not only the camera", async () => {
    const id = await trees.save({ ...blankTree(), commonName: "Olive" });
    await events.add({ treeId: id, type: "note", date: "2026-01-10", notes: "repotted" });
    const { container } = renderApp();
    fireEvent.click(await screen.findByText("Olive"));
    await screen.findByText("repotted");

    const inputs = [...container.querySelectorAll('input[type="file"]')];
    expect(inputs).toHaveLength(2); // tree gallery + event photo
    for (const input of inputs) {
      expect(input).toHaveAttribute("accept", "image/*");
      // `capture` would send a phone straight to the camera.
      expect(input).not.toHaveAttribute("capture");
    }
  });

  it("says so when the picked file cannot be used, and stores nothing", async () => {
    const id = await trees.save({ ...blankTree(), commonName: "Olive" });
    const { container } = renderApp();
    fireEvent.click(await screen.findByText("Olive"));
    await screen.findByText("Clinical history");

    image.fail = true;
    const input = container.querySelector('input[type="file"][accept="image/*"]');
    fireEvent.change(input, {
      target: { files: [new File(["x"], "clip.mp4", { type: "video/mp4" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be added");
    expect(await photos.forTree(id)).toHaveLength(0);

    // An image that decodes but cannot be encoded is refused the same way.
    image.fail = false;
    image.empty = true;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "odd.png", { type: "image/png" })] },
    });
    await screen.findByRole("alert");
    expect(await photos.forTree(id)).toHaveLength(0);
    image.empty = false;

    // So is a file far too large to decode safely, before any decoding.
    const huge = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: 30_000_001 });
    fireEvent.change(input, { target: { files: [huge] } });
    await screen.findByRole("alert");
    expect(await photos.forTree(id)).toHaveLength(0);

    // A later good pick works and clears the message.
    image.fail = false;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() => expect(container.querySelector("img.thumb")).not.toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("picking a photo for an event", () => {
  afterEach(() => {
    image.fail = false;
  });

  it("reports a failure on that event, then attaches a good pick to it", async () => {
    const id = await trees.save({ ...blankTree(), commonName: "Olive" });
    const eventId = await events.add({
      treeId: id,
      type: "note",
      date: "2026-01-10",
      notes: "repotted",
    });
    const { container } = renderApp();
    fireEvent.click(await screen.findByText("Olive"));
    const row = (await screen.findByText("repotted")).closest("li");
    const eventInput = container.querySelectorAll('input[type="file"]')[1];

    image.fail = true;
    fireEvent.click(within(row).getByText("+ Photo"));
    fireEvent.change(eventInput, {
      target: { files: [new File(["x"], "clip.mp4", { type: "video/mp4" })] },
    });
    expect(await within(row).findByRole("alert")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1); // only next to that event

    image.fail = false;
    fireEvent.click(within(row).getByText("+ Photo"));
    fireEvent.change(eventInput, {
      target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(async () => expect(await photos.forTree(id)).toHaveLength(1));
    expect((await photos.forTree(id))[0].eventId).toBe(eventId);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("new tree from an existing one", () => {
  async function seedLemon() {
    const id = await trees.save({
      ...blankTree(),
      label: "07",
      commonName: "Lemon",
      scientificName: "Citrus × limon",
      sunSpec: "full-sun",
      observedSun: "part-shade",
      quirks: "drops leaves when moved",
      careSchedule: [{ task: "Water", intervalDays: 3, lastDone: "2026-11-01" }],
    });
    await events.add({ treeId: id, type: "note", date: "2026-01-10", notes: "repotted" });
    return id;
  }

  it("opens a pre-filled form and saves a separate tree, leaving the original alone", async () => {
    const sourceId = await seedLemon();
    renderApp();
    fireEvent.click((await screen.findAllByText("Lemon")).at(-1));
    await screen.findByText("repotted");

    fireEvent.click(screen.getByText("Duplicate"));
    expect(await screen.findByText(/New tree from another one/)).toBeInTheDocument();
    expect(screen.getByLabelText("Common name")).toHaveValue("Lemon");
    expect(screen.getByLabelText("Scientific name")).toHaveValue("Citrus × limon");
    const label = screen.getByLabelText(/^Pot label/);
    expect(label).toHaveValue("");

    // Nothing exists yet: the copy is only saved on request.
    expect(await trees.all()).toHaveLength(1);

    fireEvent.change(label, { target: { value: "08" } });
    fireEvent.click(screen.getByText("Save tree"));
    await screen.findByText("Clinical history");

    const all = await trees.all();
    expect(all).toHaveLength(2);
    const copy = all.find((tr) => tr.id !== sourceId);
    expect(copy).toMatchObject({
      label: "08",
      commonName: "Lemon",
      scientificName: "Citrus × limon",
      sunSpec: "full-sun",
      observedSun: "unknown",
      quirks: "",
    });
    expect(copy.careSchedule).toMatchObject([{ task: "Water", intervalDays: 3, lastDone: null }]);
    expect(await events.forTree(copy.id)).toEqual([]);
    expect(screen.queryByText("repotted")).toBeNull(); // the new tree's own, empty history

    const original = await trees.get(sourceId);
    expect(original).toMatchObject({ label: "07", observedSun: "part-shade" });
    expect(original.careSchedule[0].lastDone).toBe("2026-11-01");
    expect(await events.forTree(sourceId)).toHaveLength(1);
  });

  it("goes back to the original tree on cancel, without creating anything", async () => {
    await seedLemon();
    renderApp();
    fireEvent.click((await screen.findAllByText("Lemon")).at(-1));
    await screen.findByText("repotted");

    fireEvent.click(screen.getByText("Duplicate"));
    await screen.findByText(/New tree from another one/);
    fireEvent.click(screen.getByText("← Cancel"));

    expect(await screen.findByText("repotted")).toBeInTheDocument();
    expect(await trees.all()).toHaveLength(1);
  });

  it("does not carry a cancelled copy into a later new tree or an edit", async () => {
    await seedLemon();
    renderApp();
    fireEvent.click((await screen.findAllByText("Lemon")).at(-1));
    await screen.findByText("repotted");
    fireEvent.click(screen.getByText("Duplicate"));
    await screen.findByText(/New tree from another one/);
    fireEvent.click(screen.getByText("← Cancel"));
    await screen.findByText("repotted");

    // Editing the original is a plain edit of that tree.
    fireEvent.click(screen.getAllByText("Edit")[0]);
    expect(await screen.findByLabelText(/^Pot label/)).toHaveValue("07");
    expect(screen.queryByText(/New tree from another one/)).toBeNull();
    fireEvent.click(screen.getByText("← Cancel"));
    await screen.findByText("repotted");

    // And a new tree from the list starts blank.
    fireEvent.click(screen.getByText("← All trees"));
    fireEvent.click(await screen.findByText("Add tree"));
    expect(await screen.findByLabelText("Common name")).toHaveValue("");
    expect(screen.queryByText(/New tree from another one/)).toBeNull();
  });

  it("opens a plain blank form when the tree to copy no longer exists", async () => {
    const id = await seedLemon();
    renderApp();
    fireEvent.click((await screen.findAllByText("Lemon")).at(-1));
    await screen.findByText("repotted");

    await trees.remove(id); // deleted elsewhere while the detail was open
    fireEvent.click(screen.getByText("Duplicate"));
    expect(await screen.findByLabelText("Common name")).toHaveValue("");
    expect(screen.queryByText(/New tree from another one/)).toBeNull();
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

  it("flags an overdue tree with an at-a-glance badge in its list row", async () => {
    await trees.save({
      ...blankTree(),
      commonName: "Quince",
      careSchedule: [
        {
          task: "Water",
          intervalDays: 7,
          intervalDaysSummer: null,
          intervalDaysWinter: null,
          lastDone: null,
        },
      ],
    });
    renderApp();
    // The ⚠️ icon carries the attention title; the panel heading is plain text.
    expect(await screen.findByTitle("Needs attention")).toBeInTheDocument();
  });
});

describe("tree list controls", () => {
  const rowNames = (container) =>
    [...container.querySelectorAll(".tree-card strong")].map((el) => el.textContent);

  it("filters the list by the search box", async () => {
    await trees.save({ ...blankTree(), commonName: "Meyer Lemon" });
    await trees.save({ ...blankTree(), commonName: "Black Mission Fig" });
    await trees.save({ ...blankTree(), commonName: "Kumquat" });
    renderApp();
    await screen.findByText("Kumquat");

    fireEvent.change(screen.getByPlaceholderText(/Search by name/), {
      target: { value: "fig" },
    });

    expect(screen.getByText("Black Mission Fig")).toBeInTheDocument();
    expect(screen.queryByText("Meyer Lemon")).toBeNull();
    expect(screen.queryByText("Kumquat")).toBeNull();
  });

  it("finds a tree by one of its other common names (synonyms)", async () => {
    await trees.save({ ...blankTree(), commonName: "Guayabo", otherNames: ["Guava", "Psidium"] });
    await trees.save({ ...blankTree(), commonName: "Higo" });
    renderApp();
    await screen.findByText("Higo");

    fireEvent.change(screen.getByPlaceholderText(/Search by name/), {
      target: { value: "psidium" },
    });

    expect(screen.getByText("Guayabo")).toBeInTheDocument();
    expect(screen.queryByText("Higo")).toBeNull();
  });

  it("filters to only trees needing a pollination partner", async () => {
    await trees.save({ ...blankTree(), commonName: "Apple", pollination: "needs-partner" });
    await trees.save({ ...blankTree(), commonName: "Peach", pollination: "self" });
    renderApp();
    await screen.findByText("Apple");

    fireEvent.click(screen.getByLabelText(/Needs partner only/));

    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.queryByText("Peach")).toBeNull();
  });

  it("reorders the list by the chosen sort", async () => {
    await trees.save({ ...blankTree(), label: "03", commonName: "Apple" });
    await trees.save({ ...blankTree(), label: "01", commonName: "Cherry" });
    await trees.save({ ...blankTree(), label: "02", commonName: "Banana" });
    const { container } = renderApp();
    await screen.findByText("Cherry");

    // Default sort is by pot label: 01 Cherry, 02 Banana, 03 Apple.
    expect(rowNames(container)).toEqual(["Cherry", "Banana", "Apple"]);

    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "name" } });
    expect(rowNames(container)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("groups trees under species headings", async () => {
    await trees.save({ ...blankTree(), commonName: "Meyer Lemon", scientificName: "Citrus × limon" });
    await trees.save({ ...blankTree(), commonName: "Eureka Lemon", scientificName: "Citrus × limon" });
    await trees.save({ ...blankTree(), commonName: "Fig", scientificName: "Ficus carica" });
    renderApp();
    await screen.findByText("Fig");

    fireEvent.click(screen.getByLabelText(/By species/));

    expect(screen.getByRole("heading", { name: "Citrus × limon" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ficus carica" })).toBeInTheDocument();
    // both lemons still present, grouped together
    expect(screen.getByText("Meyer Lemon")).toBeInTheDocument();
    expect(screen.getByText("Eureka Lemon")).toBeInTheDocument();
  });
});

describe("retired location field", () => {
  // Location and zones were removed from the UI. Data recorded with them is
  // left in place, so an old tree or an old backup must keep working and keep
  // its value.
  it("shows no location anywhere and keeps the stored value through an edit", async () => {
    await pouch.put({ _id: "settings:zones", zones: ["North terrace"] });
    const id = await trees.save({
      ...blankTree(),
      commonName: "Lemon",
      positionOnTerrace: "North terrace",
    });
    renderApp();

    const card = await screen.findByText("Lemon");
    expect(screen.queryByText(/North terrace/)).toBeNull(); // list card
    expect(screen.queryByLabelText("Location")).toBeNull(); // list filter

    fireEvent.click(card);
    await screen.findByText("Clinical history");
    expect(screen.queryByText(/North terrace/)).toBeNull();
    expect(screen.queryByText("Zones")).toBeNull();

    fireEvent.click(screen.getAllByText("Edit")[0]);
    const name = await screen.findByLabelText("Common name");
    expect(screen.queryByLabelText("Location")).toBeNull();
    fireEvent.change(name, { target: { value: "Meyer Lemon" } });
    fireEvent.click(screen.getByText("Save tree"));
    await screen.findByText("Clinical history");

    const saved = await trees.get(id);
    expect(saved.commonName).toBe("Meyer Lemon");
    expect(saved.positionOnTerrace).toBe("North terrace");
    expect((await pouch.get("settings:zones")).zones).toEqual(["North terrace"]);
  });

  it("does not add the field to new trees", async () => {
    expect(blankTree()).not.toHaveProperty("positionOnTerrace");
  });
});

describe("care task calendar export", () => {
  it("downloads an .ics for a care task from the detail view", async () => {
    await trees.save({
      ...blankTree(),
      commonName: "Rosemary",
      careSchedule: [
        {
          task: "Water check",
          intervalDays: 7,
          intervalDaysSummer: null,
          intervalDaysWinter: null,
          lastDone: null,
        },
      ],
    });
    const captured = [];
    window.URL.createObjectURL = vi.fn((blob) => (captured.push(blob), "blob:mock"));
    renderApp();

    fireEvent.click(await screen.findByText("Rosemary"));
    fireEvent.click(await screen.findByText("Add to calendar"));

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].type).toBe("text/calendar");
    const ics = await captured[0].text();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("RRULE:FREQ=DAILY;INTERVAL=7");
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
