# Orchard Log — project context for Claude Code

Local-first PWA to keep a **clinical history** of potted fruit trees on a
terrace. One owner, one device, no backend, no accounts. This file is the
behavioral contract for working in this repo — read it before making changes.

## What this app is (and the one idea that drives it)

Each tree has a **spec** (what references say: full sun, water, min temp…) and
an **observed** reality (what the owner's plant actually does in their spot).
The whole point is that observed overrides spec — e.g. the label says "full
sun" but the plant scorched on the terrace, so it now lives in part shade. Keep
these two clearly separate in data and UI. Do not collapse them.

## Direction (decided 2026-07-22, backend revised 2026-11-22): read `docs/ROADMAP.md`

Storage is **PouchDB** (IndexedDB in the browser), with **optional** sync
through the app's own API: Cloudflare Pages Functions (`functions/api/`) backed
by **D1**, same-origin with the app and behind **Cloudflare Access**. Access
decides who gets in; the API verifies the Access JWT itself and lets only
`EDITOR_EMAIL` write, everyone else is read-only. Sync is a build flag
(`VITE_SYNC=1`), not a code fork; `VITE_DEMO=1` builds a local-only demo with
sample data, used for local visual checks and not deployed anywhere. This
**supersedes two hard constraints below**: the app has an optional backend, and
`dexie` was replaced by `pouchdb`. Ids are UUIDs and photos are PouchDB
attachments; their images sync through a private R2 bucket. Everything else in this file still holds,
especially spec-vs-observed, bilingual UI, and export must keep working. The
sections below still describe parts of the pre-migration code; check
`docs/ROADMAP.md` for phase status before assuming.

Sync rules worth knowing before touching `src/data/sync.js` or `server/`:

- `shared/sync.js` is the contract both sides import (which ids sync, size
  limits, canonical body). Change it in one place only.
- The server keeps one current version per document; last write wins.
- Deploys do not reload open tabs, so an old build can keep talking to a new
  server. The app looks for a new service worker when it comes back into view
  and, in the usual case, offers a reload once one has taken control
  (`src/lib/update.js`). That is a courtesy and can miss; the guarantee is the
  version check that follows. The app sends `SYNC_PROTOCOL` (`shared/sync.js`) on every request
  and the API answers 426 to older builds, which then ask for a reload. Bump
  it whenever an old client could mishandle what the server now sends (a new
  document family, a changed document shape).
- Never trust that Access is in front of the API: the `*.pages.dev` hostname is
  not behind it. Every route goes through `functions/api/_middleware.js`.
- A photo is a document plus an image. The image goes through
  `/api/photos/<name>` and is stored in R2 under the photo's id; the bucket is
  private and has no public URL. Images are served with headers that stop a
  browser from treating them as anything but an image, and uploads are
  accepted by their bytes (JPEG, PNG, WebP), never by the declared type.
- Local API: `pnpm dev:api` (see `.env.local.example` and `.dev.vars.example`).

## Hard constraints — do not violate

- **All code and documentation in English.** Comments, identifiers, commit
  messages, docs, and translation *keys* — English.
- **User-facing UI copy is bilingual (Spanish + English) via `src/lib/i18n.jsx`.**
  Default language is Spanish; user can switch via the top-bar toggle; choice
  persists in localStorage. Never hardcode a user-visible literal in a
  component — add a key to *both* `es` and `en` dictionaries and read it with
  `t('the.key')`. This also applies to enum labels: option values stay as
  english slugs (`"full-sun"`), and the display label comes from a key like
  `sun.full-sun`. When adding a new string, keep the ES and EN entries next
  to each other so nobody forgets one.
- **Local-first.** All data lives in IndexedDB on the device. Never introduce a
  server, account system, or required network call to read/write user data.
- **Minimal dependencies.** Runtime deps are exactly: `react`, `react-dom`,
  `pouchdb-core`, `pouchdb-adapter-idb` and `events` (a polyfill PouchDB
  needs). Data stored before the move to PouchDB is read with the raw IndexedDB
  API, not with Dexie. Do not add a router, state library, UI kit, or date
  library without a clear reason. There is intentionally no react-router —
  view state lives in `App.jsx`.
- **No push notifications.** iOS PWA push is unreliable; reminders are done as
  an in-app "Needs attention" list (`src/lib/attention.js`). Don't replace it
  with web push. `.ics` calendar export is the acceptable escalation.
- **Export must keep working.** Local data can be lost. `src/lib/backup.js` is
  the only backup. Any schema change must remain importable, or ship a migration.

## Commands

```bash
npm install
npm run dev       # dev server
npm run build     # production build -> dist/ (must stay green)
npm run preview   # serve the build
```

Deploy target: Cloudflare Pages, which also runs the API and binds the database
and photo bucket (see Release). A build without sync is plain static files.
Verified building on Node 22.

## Release

**Merging to `main` deploys.** `.github/workflows/deploy-cloudflare.yml` lints,
tests and builds with `VITE_SYNC=1` in one job, then, in a separate job that
holds the Cloudflare token, applies pending D1 migrations to the remote database
and deploys the app and its API to the Cloudflare Pages project (`orchard-log`).
A manual run of that workflow deploys only when started from `main`.
There is no public demo deployment.

**Versions are labels, not a gate.** `.github/workflows/release.yml` runs
release-please on every push to `main` and keeps one release pull request up to
date: the next version in `package.json`, and `CHANGELOG.md`, both worked out
from the Conventional Commit messages since the last release. Merging that pull
request creates the tag (`vX.Y.Z`) and the GitHub release. So:

- Never bump `package.json`'s version, edit `CHANGELOG.md` or
  `.release-please-manifest.json`, or create a tag by hand. The one exception
  was the starting point: the tag `v1.0.0`, placed by hand on the commit the
  first release counts from, because release-please only looks at commits
  after the tag that matches its manifest. Commit messages are
  the input: `feat` is a minor bump, `fix` a patch, `!` or `BREAKING CHANGE` a
  major.
- The app shows its version and the commit it was built from in the Backup menu
  (`src/lib/version.js`). Use that to tell which build a device is running.
- The release pull request is opened with the workflow token, so its CI run
  waits for the owner: open the pull request and press "Approve and run". On
  the v1.1.0 release a green `workflow_dispatch` run of CI on the same commit
  did not satisfy the required check; the merge was accepted only after the
  pull request's own run was approved. Treat the approval as a step in the
  procedure, not as a security control.
- Read the release pull request's diff before merging it. Titles of merged
  pull requests go into the changelog as written, and a merged pull request's
  body can override how release-please reads its commits.
- `release.yml` runs third-party code with write access to the repository. Do
  not give that job `actions: write`, and do not loosen the approval rule on
  `main` (a code owner review, with `.github/CODEOWNERS` naming only the
  owner): together they stop a workflow from approving and merging.
- Merging is done by the owner bypassing that rule, on a commit that was read:
  `gh pr merge <n> --squash --admin --match-head-commit <sha>`. Do not leave an
  approval on a pull request instead; a branch can change after it. This
  matters most for the release pull request, whose branch is written by a
  workflow: read its diff at that commit before merging.

- A direct push to `main` is a production deploy and a schema change. Go
  through a PR.
- A migration ships in the same PR as the code that needs it, and must leave
  the code already in production working, because it is applied first. If the
  deploy then fails, production keeps running the old code on the new schema.
  Migrations run unattended: no destructive statement without a recovery plan.
- `wrangler.toml` variables travel with the deploy. Secrets (`EDITOR_EMAIL`)
  do not: change them with `wrangler pages secret put`, then redeploy.
- Keep credentials out of the first job of the deploy workflow (`bundle`). It
  runs third-party code. It is not called `build` on purpose: that is the name
  of the required check, which comes from `ci.yml`.
- Every action in every workflow is pinned to a commit SHA, with the version
  in a trailing comment. Dependabot (`.github/dependabot.yml`) proposes the
  updates; never replace a SHA with a tag by hand.
- Manual fallback, from a clean and up-to-date `main`, after `pnpm lint` and
  `pnpm test`: `wrangler d1 migrations apply orchard --remote`,
  `VITE_SYNC=1 pnpm build`,
  `wrangler pages deploy dist --project-name orchard-log --branch main`.
- Rollback: redeploy an earlier deployment from the Pages dashboard (re-running
  an old workflow run also ships that old code). Neither rolls back the
  database; D1 Time Travel is the recovery path for data.

## Project layout

```
src/
  main.jsx                     mount, legacy-data migration, sync start
  App.jsx                      view routing (list | detail | form), no router
  data/                        the only layer that touches storage
    backend.js                 the local PouchDB database and id helpers
    adapter.js / .memory.js    storage adapter: IndexedDB in the app, memory in tests
    repository.js              trees / events / photos: what components call
    model.js                   enums, blank tree, derived values, tree copy
    useLive.js, useCanEdit.js  reactive query hook, edit permission hook
    sync.js                    push/pull with the API (see Direction)
    migrate.js                 one-time import of pre-PouchDB data
  lib/
    image.js                   downscale and re-encode a picked photo
    attention.js               computes the "Needs attention" list
    backup.js, backupReminder.js   export/import, and the export reminder
    i18n.jsx                   bilingual (es/en) dictionary + provider + hook
    harvest.js, phenology.js, ics.js, demo.js, update.js, version.js
  components/                  one file per screen or banner
  styles.css                   botanical-notebook theme via CSS vars
shared/sync.js                 sync contract shared by the app and the API
functions/api/                 the API routes (Cloudflare Pages Functions)
server/                        auth, document store and photo store for the API
migrations/                    D1 schema
public/                        favicon.svg + PWA icons
```

## Data model (`src/data/`)

One local PouchDB database. Documents are typed by `_id` prefix:

- `tree:<uuid>`: identity, provenance, physical, **spec fields**, **observed
  fields**, and `careSchedule` (array of `{task, intervalDays, lastDone}` plus
  optional seasonal intervals).
- `event:<uuid>`: timeline rows: `repot | prune | fertilize | pest | treatment |
  flowering | fruit-set | harvest | problem | move | note`.
- `photo:<uuid>`: belongs to a tree and optionally to an event. The image is an
  attachment named `image`.

Notes:
- Estimated age is derived, not stored: `estimatedAgeMonths(tree)` from
  `purchaseDate + claimedAgeMonthsAtPurchase`.
- Pollination partner is a reference by tree `id`.
- Reactivity uses `useLive` from `src/data` (it re-runs a query on every
  database change); prefer it over manual reads so views update automatically.

## Gotchas

- **No local schema.** PouchDB documents are schemaless: adding a field needs
  no migration. Changing what an existing field means does, and old backups
  must still import. The server-side schema lives in `migrations/` and is
  applied by the deploy.
- **Backup format versioning.** `backup.js` writes `{ app, version }`. If the
  shape changes, bump `version` and migrate on import. Keep old backups loadable.
- **Photos are Blobs** in IndexedDB and **base64** in the export (~33% larger).
  Downscale on capture (`downscaleImage`, default 1600px) — keep it.
- **Object URLs** from blobs must be revoked; see the `Photo` component pattern.

## Conventions

- Functional components + hooks. Keep components small and focused.
- Derive, don't duplicate: computed values (age, attention) live in helpers.
- Any control that writes data is rendered only when `useCanEdit()` (from
  `src/data`) is true, so read-only accounts do not see it. This is a courtesy
  to the user, never the access control: the API enforces who may write.
- Styling via the CSS variables in `styles.css`; keep the a11y floor already in
  place (`:focus-visible`, `prefers-reduced-motion`, mobile breakpoint).
- Keep the build green and the app installable (don't break the PWA manifest /
  service worker in `vite.config.js`).

## Working conventions — commits, PRs, deliverables

General working rules imported from the owner's other repos. Not tied to any one
feature; they govern how changes are committed and shipped in this repo.

### Language in git/GitHub artifacts

- English everywhere in the repo and its metadata: commit messages, branch names,
  PR titles and bodies, and GitHub issue/PR comments — same as the code/docs rule
  in Hard constraints. The ONLY bilingual surface is user-facing UI copy via
  `src/lib/i18n.jsx`. No Spanish in git/GitHub artifacts.

### Commits

- **Conventional Commits**: `<type>(<optional scope>): <subject>`. Types:
  `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `perf`, `ci`.
- **One logical change per commit.** If you spot an unrelated bug while working,
  report it — do not bundle the fix.
- Never run `git commit` on your own initiative. When a task is done, propose the
  message in chat as plain text:

  > Task done. Proposed commit:
  >
  > ```
  > <type>(<scope>): <subject>
  >
  > <optional body>
  > ```
  >
  > Want to commit?

- On explicit confirmation ("yes" / "si" / "go ahead"), commit with that message
  **verbatim** — no paraphrasing or re-editing. Otherwise, do not commit.
- **No Claude/Anthropic attribution anywhere.** Omit every attribution trailer
  from commit messages and PR bodies — no `Co-Authored-By:` trailer, no
  `Claude-Session:` line, no "Generated with Claude Code" footer. Commits and PRs
  carry only their own content.

### Pull requests

- After a branch is pushed, offer to open the PR (needs `gh`). Propose a title +
  body and ask "Want to open the PR?" — same explicit-confirmation rule as
  commits. Do not run `gh pr create` without a "yes".
- Default base `main`; for stacked branches target the parent via `--base`.
- **Title:** Conventional-Commits style, mirroring the lead commit (a squash
  merge uses it as the squash message).
- **Body must stand alone.** A stranger should understand it without this
  conversation, the diff, or any local files. So: NO session references ("as we
  discussed", "per the user"), NO pointers to untracked/local files. DO include
  summary, motivation, scope (in / out), and a test plan (how a reviewer
  verifies).
- Open with:

  ```bash
  gh pr create --base <base> --title "<title>" --body "$(cat <<'EOF'
  <body>
  EOF
  )"
  ```

### Branching & merging

- Independent work → branch from `main`. Chained work → stacked branches, each
  cut from and targeting the previous.
- **Never merge-commit.** Squash or rebase only; a squash message must itself be
  a valid Conventional Commit.
- Branch naming: independent `<type>/<short-slug>` (e.g. `fix/attention-tz`);
  stacked `feat/<area>-<phase>-<slug>`.
- Never force-push a branch under review without commenting on the PR; use
  `--force-with-lease`.

### Secrets

- Never commit `.env` / `.env.*`.
- Never log the value of any env var whose name contains `KEY`, `TOKEN`,
  `SECRET`, or `PASSWORD`.

### Local-only / untracked files

- Untracked scratch (TODO notes, drafts) must NEVER be referenced from committed
  source, tests, or docs — those become broken pointers in every other clone.

### Task deliverables

When reporting a task as done, include:

1. **Tests** — run the relevant Vitest files. If none apply (config / docs /
   infra only), say so explicitly.
2. **Lint** — `pnpm lint` clean for the files you touched; report, don't hide,
   any pre-existing issues.
3. **Build** — `pnpm build` green if you changed runtime/build surface (both
   bases when the base path is affected).
4. **Files touched** — a short list so the user can review before staging.
5. **Proposed commit message** in the shape above, ending with "Want to commit?".

## Backlog (rough priority)

1. Attach photos to a specific event and render them inline in the timeline
   (schema already supports `photos.eventId`).
2. Edit and delete individual events; photo lightbox + delete.
3. `.ics` export per care task so the phone's calendar can remind.
4. List UX: search, sort, filter, group by species; badge trees missing a
   pollination partner.
5. Harvest tracking: record yield on `harvest` events, show per-tree/season
   totals.
6. Data safety: gentle periodic "export your data" nudge.
7. Optional cloud sync built on top of the existing export format (e.g. a file
   in the owner's Drive) — must stay optional and local-first by default.
8. Tests: none yet. If adding, use Vitest; start with `db.js` helpers and
   `attention.js`.

## Suggested first session

> Read CLAUDE.md. Run `npm install && npm run build` to confirm the baseline is
> green. Then implement backlog item 1 (photos attached to events, shown in the
> timeline), keeping the export format backward-compatible.