# Orchard Log — improvement roadmap

Direction decided 2026-07-22. The app migrates from Dexie/IndexedDB to
**PouchDB** as its single storage layer, with **optional** live sync to a
self-hosted **CouchDB**. Because PouchDB uses IndexedDB locally, the same
codebase serves both:

- **Demo build** — PouchDB with no sync (local-only, no backend), with sample
  data. Built locally and in CI; not deployed.
- **Real build** — PouchDB + sync through the app's own API (see Phase 3;
  originally planned as CouchDB replication).

Sync is a config flag, not a code fork. Integer auto-increment ids become
**UUIDs** and photos become PouchDB **attachments**, which removes the
cross-device id-collision merge bug by design.

> This intentionally overrides two former hard constraints in `CLAUDE.md`
> ("no backend", "minimal dependencies" — `dexie` is replaced by `pouchdb`).

## Phase 0 — Safety net (before touching anything)

- [x] Initialise git (prerequisite for CI).
- [x] Test toolchain: Vitest + fake-indexeddb + Testing Library.
- [x] Characterization tests that freeze current behaviour before migrating:
  - [x] `estimatedAgeMonths`, `normalizeSun/WaterEnum`, `migrateTreeToV2`.
  - [x] `computeAttention`: seasonal intervals, overdue, never-done, repot-due.
  - [x] `backup.js`: export→import round-trip, v1 migration, invalid-file /
        invalid-structure guards.
  - Surfaced a real timezone bug: `new Date("YYYY-01-01").getFullYear()` in
    `attention.js` returned the prior year in UTC-3 — fixed in Phase 1 via
    `parseLocalDate`; tests pin `TZ=UTC` for determinism.
- [x] Second code-review pass focused on the data-access + reactivity layers
      (confirmed only `db.js`, `src/data/`, `backup.js`, `demo.js` touch the DB).
- [x] ESLint + Prettier config (needed for the CI lint step).

**Exit:** green suite describing what the app does today.

## Phase 0.5 — Public demo now (quick win)

- [x] Seed sample trees so it isn't empty; "demo mode" banner + reset button
      (`VITE_DEMO` flag; demo code is tree-shaken out of normal builds).
- Dropped 2026-11-22: deploying the demo to GitHub Pages. The repository is
      private, so Pages was never enabled and the workflow failed on every
      push to `main`. The workflow is removed; the demo build stays for local
      use and is still built in CI.

**Exit:** a seeded local-only demo build. The public deployment was dropped.

## Phase 1 — Storage abstraction + model redesign

- [x] Repository layer (`src/data/`): `trees`/`events`/`photos` repos; every
      component + `attention.js` goes through it. Only `src/data/` and `db.js`
      touch Dexie now (`backup.js` stays backend-level by design).
- [x] Reactive hook seam: `src/data/useLive.js` (the sole `dexie-react-hooks`
      importer). Phase 2 reimplements it over PouchDB's `changes` feed without
      touching any call site — that's why it exists.
- [ ] Doc model — **moved to Phase 2.** UUIDs / typed docs / attachments only
      pay off with the PouchDB swap; doing them on Dexie `++id` now is churn.
      The repo API already hides id type from callers, so it's ready.
- [ ] Custom PouchDB build to keep the bundle in check → Phase 2.

**Exit:** components talk to the data layer, not the DB (done). Layer has tests
(`repository.test.js`). Timezone bug fixed.

## Phase 2 — Migrate to PouchDB (local, no sync)

- [x] Swap Dexie → PouchDB (idb adapter in the browser), behaviour identical.
- [x] Doc model (deferred from Phase 1): typed by `_id` prefix
      (`tree:`/`event:`/`photo:`), UUID ids, photos as base64 attachments.
- [x] Non-destructive one-time migration Dexie→Pouch (`data/migrate.js`); old
      Dexie db left intact as a fallback; a `_local` flag makes it run once.
- [x] `backup.js` → v3 (docs + attachments); v1/v2 backups still import.
- [x] Custom build: `pouchdb-core` + only the idb adapter (+ `events` polyfill),
      not the monolithic `pouchdb`. Bundle ~87 kB gzip.
- [x] Tests for repository, migration, backup round-trip + legacy import, model.
- [x] Adapter alias: idb for prod, in-memory for tests (`@adapter`).

**Exit:** app runs on PouchDB. Verified in a real browser (seed, list,
attention, spec-vs-observed detail; no console errors). This build is the
Phase 0.5 demo, upgraded.

## Phase 3 — Sync backend

**Direction changed 2026-11-22.** The backend is no longer CouchDB on the Pi.
It is a small sync API on **Cloudflare Pages Functions + D1**, same-origin with
the app, behind **Cloudflare Access**. Reasons: no always-on home server, no
second cloud account, and the access rule is now "one editor, everyone else
read-only", which removes the need for CouchDB's multi-writer conflict
handling. PouchDB stays as the local store; only the replication layer changes.

How it fits together:

- **Access** decides who gets in (email allow-list on the site's hostname).
- **The API** verifies the Access JWT on every request and decides who may
  write: only `EDITOR_EMAIL`. Everyone else Access admits is read-only. The
  check lives in the API because the project's `*.pages.dev` hostname is not
  behind Access.
- **D1** holds one row per document with a server-assigned, increasing `seq`.
  Devices push local changes and pull "everything after the last seq I saw".
  Last write wins; an identical re-push is a no-op.
- **Photos** sync as a document plus an image kept in R2 (see below).

- [x] API: `functions/api/` (`me`, `changes`, `docs`, `login`) + `server/`
      (Access JWT verification, D1 store) + `migrations/0001_init.sql`. Tests
      run the real handlers against a local D1 (`test/api.test.js`).
- [x] App: `data/sync.js` pushes and pulls against the API, gated by
      `VITE_SYNC=1` (no-op otherwise; the demo never syncs). The contract both
      sides share (synced ids, size limits, canonical body) is `shared/sync.js`.
      A banner reports an expired session (with a sign-in link), offline, sync
      errors and read-only accounts. End-to-end tests run the real engine on
      in-memory devices against the real handlers (`test/sync.test.js`).
- [x] CouchDB dev slice removed (replication adapters, docker compose, the
      `VITE_COUCHDB_URL` CSP plugin).
- [x] PWA under Access: manifest fetched with credentials; `/api` navigations
      bypass the cached app shell.
- [x] D1 database created (`orchard`).
- [x] Cloudflare: schema applied remotely, Pages project, custom domain,
      Access application + policy, `EDITOR_EMAIL` secret, first deploy. Real
      data migrated by importing a backup on the new origin.

After the first deploy, in this order:

- [x] Read-only accounts no longer see the controls that write (`useCanEdit`;
      the last known role is remembered on the device so it also applies
      offline and before the first request answers).
- [x] Deploy the real app from CI on merge to `main`
      (`deploy-cloudflare.yml`: lint, test, build, migrations, deploy).
- [x] Photo sync. Images live in a private R2 bucket (`orchard-photos`) with
      no public URL, served only through `/api/photos/<name>` behind the same
      identity checks. A photo's document syncs like any other; a device
      uploads the image before pushing the document and downloads it before
      writing the document locally, so every device holds every image and the
      backup export stays complete. Deleting the document deletes the image.

How the app decides which side is newer: per document, it remembers the local
revision that last matched the server. A different current revision is an
unpushed local edit and wins over an incoming change (last write wins, no
merge). A document it has never reconciled loses to the server's copy of the
same id, so a device joining with old data cannot overwrite shared data. A
read-only device always takes the server's version and re-pulls after any
local edit or restore.

Version skew: a tab keeps running the build it loaded, across deploys. The app
sends its sync contract version and the API refuses older ones (426), so an old
tab stops syncing and asks for a reload instead of storing data it mishandles.
This was added after a tab from before photo sync pulled a photo document
without its image; the app also repairs such documents on the next sync.

Known limit: the same document edited on two of the editor's devices while one
is offline keeps whichever syncs last.

**Exit:** the owner edits from any of their devices and invited readers see the
same plants, offline-first.

## Phase 4 — Features (platform now solid)

- [x] Edit/delete events (inline in the timeline; `events.update`/`remove`).
- [x] Photos per event, inline in the timeline, lightbox + delete
      (`+ Foto` per entry; `photos.remove`; shared full-screen lightbox).
- [x] Harvest/yield on `harvest` events (amount + unit), per-year totals
      (`lib/harvest.js`; summary in the tree detail).
- [x] List: search / sort / filter (needs-partner) / group by species.
- [x] `.ics` export per care task (recurring VEVENT + alarm; `lib/ics.js`).
- [x] Gentle periodic "export your data" nudge: a banner for whoever owns
      the data on the device when no backup was exported there, or the last
      one is over 30 days old. "Later" hides it for a week. Per device, in
      localStorage; the Backup menu shows the date of the last export.
- [x] New tree from an existing one ("Duplicate" on the detail): opens the
      new-tree form pre-filled with the names, the spec side and the care
      routine (never done). Label, provenance, physical state, pollination
      partner, observed side, events and photos are not copied.
- [x] Location and zones removed from the UI (2026-11-22). Pots get moved
      every couple of weeks as the sun shifts, so a fixed position went stale
      faster than it was useful; observed sun and its notes carry what
      matters. Stored `positionOnTerrace` values and the `settings:zones`
      document are left untouched, and the `move` event type stays. Those
      stored values still sync and still appear in exports, with no screen to
      view or clear them; erasing them is a separate, deliberate cleanup.

## Phase 5 — CI/CD + deployment testing

- [x] `ci.yml`: pnpm install → lint → test → build ×2 (base `/` and project base).
- Removed: `deploy-pages.yml` (demo → GitHub Pages), see Phase 0.5.
- [x] E2E coverage inside the Vitest run (so CI already gates it, no Docker or
      browser needed): UI flow tests over the real App on the in-memory adapter
      (`test/flows.test.jsx`) + CouchDB sync tests via an in-process
      express-pouchdb server (`test/sync.test.js`).
- [x] Real app → Cloudflare Pages (with the Phase 3 API).
- [x] The app notices a newer build installed behind an open page and offers
      a reload, instead of finding out when the API refuses it. Checked in a
      real browser against a production build with its service worker.
- [x] Versions: release-please keeps a release pull request with the next
      version and changelog; merging it tags the release. Versions label
      `main`, they do not gate the deploy. The app shows its version and build
      commit in the Backup menu. First release: 1.0.0.
- [x] Browser tests (Playwright, `e2e/`) of the critical flows, in CI on every
      pull request: the production build with its service worker and the API,
      run locally on a throwaway database and bucket. Not against the deployed
      site, which is behind Access and holds real data.

## Phase 6 — Docs

- [x] `CLAUDE.md` and `README.md` describe the current architecture. The
      backlog that used to live in `CLAUDE.md` is gone; this file is the list.
