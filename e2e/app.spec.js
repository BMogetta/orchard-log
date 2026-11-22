import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

// What a person does with the app, in a real browser, against the real API.
// Each "device" is its own browser context: its own local database, its own
// service worker. Names are unique per run because the devices share one
// server, as real ones do.

const PHOTO = fileURLToPath(new URL("./fixtures/photo.jpg", import.meta.url));
const SYNC_HEADERS = { "x-orchard-sync": "2" };

const unique = (label) =>
  `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function device(browser, options = {}) {
  const context = await browser.newContext(options);
  // Assert against the English copy so the test strings stay English.
  await context.addInitScript(() => localStorage.setItem("orchard-log:lang", "en"));
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Backup", exact: true })).toBeVisible();
  return { context, page };
}

async function addTree(page, name) {
  await page.getByRole("button", { name: "Add tree" }).click();
  await page.getByLabel("Common name").fill(name);
  await page.getByRole("button", { name: "Save tree" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

// What the server holds: [{ id, deleted, doc }].
async function serverDocs(request) {
  const res = await request.get("/api/changes?since=0", { headers: SYNC_HEADERS });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).docs;
}

// Waits until the server has a tree with this name and returns its id.
async function treeOnServer(request, name) {
  let id;
  await expect
    .poll(
      async () => {
        const docs = await serverDocs(request);
        id = docs.find((d) => !d.deleted && d.doc?.commonName === name)?.id;
        return id;
      },
      { timeout: 20_000 }
    )
    .toBeTruthy();
  return id;
}

test("a tree is saved on the device and survives a reload", async ({ browser }) => {
  const a = await device(browser);
  const name = unique("Lemon");
  await addTree(a.page, name);

  // Offline, so the tree can only come from the device's own storage and not
  // back from the server. The app shell comes from the service worker.
  await a.page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await a.context.setOffline(true);
  await a.page.reload();
  await expect(a.page.getByText(name).first()).toBeVisible();
  await a.context.close();
});

test("a tree created on one device appears on another", async ({ browser, request }) => {
  const a = await device(browser);
  const name = unique("Fig");
  await addTree(a.page, name);
  await treeOnServer(request, name);

  const b = await device(browser);
  await expect(b.page.getByText(name).first()).toBeVisible({ timeout: 20_000 });
  await a.context.close();
  await b.context.close();
});

test("a photo added on one device is visible on another", async ({
  browser,
  request,
}) => {
  const a = await device(browser);
  const name = unique("Olive");
  await addTree(a.page, name);
  await a.page.locator('input[type="file"]').first().setInputFiles(PHOTO);
  await expect(a.page.locator("img.thumb")).toBeVisible();

  const treeId = await treeOnServer(request, name);
  await expect
    .poll(
      async () =>
        (await serverDocs(request)).some(
          (d) => !d.deleted && d.id.startsWith("photo:") && d.doc?.treeId === treeId
        ),
      { timeout: 20_000 }
    )
    .toBe(true);

  const b = await device(browser);
  await b.page.getByText(name).first().click();
  const thumb = b.page.locator("img.thumb");
  await expect(thumb).toBeVisible({ timeout: 20_000 });
  // Present is not enough: a photo stored without its image also renders an
  // <img>. It has to have decoded into real pixels.
  await expect.poll(() => thumb.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await a.context.close();
  await b.context.close();
});

test("on a phone, photos can come from the gallery and an event's note is readable", async ({
  browser,
}) => {
  const a = await device(browser, { viewport: { width: 390, height: 844 } });
  await addTree(a.page, unique("Plum"));

  // `capture` would send a phone straight to the camera, with no gallery.
  const fileInputs = a.page.locator('input[type="file"]');
  await expect(fileInputs).toHaveCount(2);
  await expect(a.page.locator('input[type="file"][capture]')).toHaveCount(0);

  const note = "aphids on the new shoots, treated with potassium soap";
  await a.page.getByPlaceholder("Notes").fill(note);
  await a.page.getByRole("button", { name: "Log", exact: true }).click();
  const noteBox = await a.page.getByText(note).boundingBox();
  const rowBox = await a.page.locator(".ev-row").first().boundingBox();
  // The note gets the row to itself instead of a sliver next to the controls.
  expect(noteBox.width).toBeGreaterThan(rowBox.width * 0.9);

  // The way back sits above the actions, not squeezed beside them.
  const back = await a.page.getByRole("button", { name: /All trees/ }).boundingBox();
  const edit = await a.page
    .getByRole("button", { name: "Edit", exact: true })
    .first()
    .boundingBox();
  expect(back.y + back.height).toBeLessThanOrEqual(edit.y);
  await a.context.close();
});

// Last on purpose: it replaces the build the server is serving.
const build = (commit) =>
  execSync("pnpm build", {
    env: { ...process.env, VITE_SYNC: "1", GITHUB_SHA: commit },
    stdio: "ignore",
  });

test("an open page notices a newer build and reloads into it", async ({ browser }) => {
  // Start from the first build even on a retry, when a previous attempt has
  // already replaced it.
  build("aaaaaaa1");
  const a = await device(browser);
  // Start from a page that is controlled by the first build's service worker.
  await a.page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await a.page.reload();
  await a.page.getByRole("button", { name: "Backup", exact: true }).click();
  await expect(a.page.getByText(/Version .*\(aaaaaaa\)/)).toBeVisible();
  await a.page.getByRole("button", { name: "Backup", exact: true }).click();

  // A deploy happens behind the open page.
  build("bbbbbbb2");

  // Coming back to the app is what makes it look for a new build.
  await a.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(a.page.getByText("There is a new version of the app.")).toBeVisible({
    timeout: 30_000,
  });

  await a.page.getByRole("button", { name: "Reload" }).click();
  await a.page.getByRole("button", { name: "Backup", exact: true }).click();
  await expect(a.page.getByText(/Version .*\(bbbbbbb\)/)).toBeVisible({
    timeout: 20_000,
  });
  await a.context.close();
});
