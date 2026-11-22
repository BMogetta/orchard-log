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
(`VITE_SYNC=1`), not a code fork; a local-only demo runs on GitHub Pages. This
**supersedes two hard constraints below**: the app has an optional backend, and
`dexie` was replaced by `pouchdb`. Ids are UUIDs and photos are PouchDB
attachments (photos do not sync yet). Everything else in this file still holds,
especially spec-vs-observed, bilingual UI, and export must keep working. The
sections below still describe parts of the pre-migration code; check
`docs/ROADMAP.md` for phase status before assuming.

Sync rules worth knowing before touching `src/data/sync.js` or `server/`:

- `shared/sync.js` is the contract both sides import (which ids sync, size
  limits, canonical body). Change it in one place only.
- The server keeps one current version per document; last write wins.
- Never trust that Access is in front of the API: the `*.pages.dev` hostname is
  not behind it. Every route goes through `functions/api/_middleware.js`.
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
  `dexie`, `dexie-react-hooks`. Do not add a router, state library, UI kit, or
  date library without a clear reason. There is intentionally no react-router —
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

Deploy target: static hosting (Cloudflare Pages / Netlify / GitHub Pages).
Verified building on Node 22.

## Release

There is no versioning, tagging or release tool. **Merging to `main` is the
release**: `.github/workflows/deploy-cloudflare.yml` lints, tests and builds
with `VITE_SYNC=1` in one job, then, in a separate job that holds the
Cloudflare token, applies pending D1 migrations to the remote database and
deploys the app and its API to the Cloudflare Pages project (`orchard-log`).
A manual run of that workflow deploys only when started from `main`.
`deploy-pages.yml` publishes the local-only demo to GitHub Pages.

- A direct push to `main` is a production deploy and a schema change. Go
  through a PR.
- A migration ships in the same PR as the code that needs it, and must leave
  the code already in production working, because it is applied first. If the
  deploy then fails, production keeps running the old code on the new schema.
  Migrations run unattended: no destructive statement without a recovery plan.
- `wrangler.toml` variables travel with the deploy. Secrets (`EDITOR_EMAIL`)
  do not: change them with `wrangler pages secret put`, then redeploy.
- Keep credentials out of the build job of the deploy workflow, and keep its
  actions pinned to commit SHAs. That job runs third-party code.
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
  main.jsx                     mount
  App.jsx                      view routing (list | detail | form), no router
  db.js                        Dexie schema + tree factory + write helpers
  lib/
    image.js                   camera capture + downscale before store
    attention.js               computes the "Needs attention" list
    backup.js                  full export/import (photos as base64 in JSON)
    i18n.jsx                   bilingual (es/en) dictionary + provider + hook
  components/
    TreeList.jsx               list, live-queried
    TreeDetail.jsx             spec-vs-observed view, timeline, photos
    TreeForm.jsx               create/edit, grouped fieldsets, care schedule
    AttentionPanel.jsx         home-screen care list
    BackupControls.jsx         export/import
  styles.css                   botanical-notebook theme via CSS vars
public/                        favicon.svg + PWA icons
```

## Data model (`src/db.js`)

Three IndexedDB tables via Dexie:

- `trees` — identity, provenance, physical, **spec fields**, **observed
  fields**, and `careSchedule` (array of `{task, intervalDays, lastDone}`).
- `events` — timeline rows: `repot | prune | fertilize | pest | treatment |
  flowering | fruit-set | harvest | problem | move | note`. Has `photoIds`
  reserved but not yet wired.
- `photos` — image blobs. Indexed by `treeId` and `eventId` (the `eventId` hook
  exists but the UI attaches photos to the tree, not to an event, yet).

Notes:
- Estimated age is derived, not stored: `estimatedAgeMonths(tree)` from
  `purchaseDate + claimedAgeMonthsAtPurchase`.
- Pollination partner is a reference by tree `id`.
- Reactivity uses `useLiveQuery` from `dexie-react-hooks`; prefer it over manual
  reads so views update automatically.

## Gotchas

- **Dexie migrations.** Changing indexes (the string in `db.version(n).stores`)
  requires bumping to `db.version(n+1)` with an `.upgrade()` when needed. Adding
  non-indexed fields to records needs no version bump. Never edit an existing
  `version()` block's schema in place.
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