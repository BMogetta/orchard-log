# Orchard Log

A local-first PWA to keep a **clinical history** of your potted fruit trees:
what each one is, where it came from, its estimated age, the reference **spec**
next to what your plant **actually does** on your terrace, a photo log, an event
timeline, and a "needs attention" list driven by each tree's own care schedule.

## Stack

- **React + Vite** — app shell and UI
- **Dexie** (IndexedDB) — all data, including photos, stored on-device
- **vite-plugin-pwa** — installable to the home screen, works offline

No backend, no account. Your data never leaves the device unless you export it.

## Run

```bash
pnpm install
pnpm dev          # local dev server
pnpm dev --host   # expose on the LAN (test from your phone)
pnpm build        # production build in dist/
pnpm preview      # serve the built app
```

## Deploy

`pnpm build` produces static files in `dist/`. Host them anywhere free:
Cloudflare Pages, Netlify, or GitHub Pages. Because data is local, that's all
you need.

On a GitHub Pages **project** site the app is served from `/<repo>/`, not the
root, so build with a matching base path:

```bash
BASE_PATH=/tree-tracker/ pnpm build
```

A user/organisation page (`user.github.io`) or a custom domain serves from the
root and needs no override — the default base is `/`.

## Data model (`src/db.js`)

Three IndexedDB tables:

- `trees` — identity, provenance, physical state, **spec** (reference
  guidance), **observed** reality (your overrides), and a `careSchedule`.
- `events` — the timeline: repot, prune, fertilize, pest, treatment, flowering,
  fruit-set, harvest, problem, move, note. Photos can attach to an event.
- `photos` — image blobs, downscaled on capture (`src/lib/image.js`).

Estimated age is derived from `purchaseDate + claimedAgeMonthsAtPurchase`
(`estimatedAgeMonths`). Pollination partners are a reference from one tree to
another by id.

## Key decisions

- **Spec vs observed** is the heart of the app — the reference says "full sun",
  your plant scorched, so the observed column overrides the book.
- **Reminders without push.** iOS PWA notifications are unreliable, so
  `src/lib/attention.js` computes an in-app "needs attention" list from each
  tree's recurring tasks and repot history instead.
- **Export early, export often.** Local data can be lost. `src/lib/backup.js`
  exports the entire database (photos included, as base64) to one JSON file and
  restores from it. There is no other backup — keep the file safe.

## Ideas to extend

- Attach photos directly to events and show them inline in the timeline.
- `.ics` export per care task so the phone's real calendar nags you.
- Per-tree microclimate notes tied to seasons.
- Optional sync to your own cloud (e.g. a file in Drive) built on top of the
  existing export format.
