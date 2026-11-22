# Orchard Log

A notebook for potted fruit trees. It keeps, for each tree, what it is and where
it came from, what the books say about the species, what your plant actually
does on your terrace, a timeline of what happened to it, photos, and a list of
what needs attention next.

It is a web app that installs on a phone and works offline. Data lives on the
device. Syncing between devices is optional.

## The idea: spec and observed

Every tree has two sides, kept apart on purpose.

- **Spec** is what references say about the species: full sun, moderate water,
  hardy to -2 °C, prune after fruiting.
- **Observed** is what this plant does in this spot: the label says full sun,
  but it scorched in the afternoon in January, so it lives in part shade.

Observed is the point. The app never merges the two.

## What it does

- A card per tree, with search, sort and grouping by species.
- A tree page with the spec next to the observed, the care routine, photos and
  a timeline of events: repot, prune, fertilize, pest, treatment, flowering,
  fruit set, harvest, problem, move, note.
- "Needs attention": overdue care tasks and repotting, worked out from each
  tree's own schedule. No push notifications; a task can be added to the
  phone's calendar instead.
- Harvest totals per year.
- A new tree can be started from an existing one, copying the species data and
  the care routine.
- Export and import of everything, photos included, as one file. A reminder
  appears when the last export on the device is over a month old.
- Spanish and English.

## How it is built

- **React and Vite**, installable as a PWA (`vite-plugin-pwa`).
- **PouchDB** over IndexedDB holds all data on the device, photos included.
  The app reads and writes there and nowhere else, so it works with no network.
- **Optional sync**, turned on at build time. The app pushes and pulls through
  its own API: Cloudflare Pages Functions, a D1 database for documents and an
  R2 bucket for photo images. Last write wins, per document.

Without sync the app is a set of static files with no backend.

### Who can do what, with sync on

- The site sits behind Cloudflare Access, which decides who gets in.
- The API verifies the Access token on every request by itself. It does not
  assume Access is in front.
- One identity, the editor, can write. Everyone else who is let in can read.
  Once the app knows an account is read-only it hides the controls that change
  data. That is a courtesy: the API rejects those writes either way.
- Photo images have no public URL. They are served only through the API.

## Run it

Requires pnpm and Node 22, the version CI and the deploy use. Newer versions
work for running the app.

```bash
pnpm install
pnpm dev          # the app, local-only, on http://localhost:5173
pnpm dev --host   # same, reachable from a phone on the same network
pnpm build        # production build in dist/
pnpm preview      # serve the build
```

To see it with sample trees instead of an empty list:

```bash
VITE_DEMO=1 pnpm dev
```

### With sync, locally

The API runs on your machine against a local database and bucket. Nothing
touches a Cloudflare account.

```bash
cp .env.local.example .env.local    # turns sync on for the dev server
cp .dev.vars.example .dev.vars      # who you are on localhost
pnpm exec wrangler d1 migrations apply orchard --local
pnpm build && pnpm dev:api          # API on :8788, keeps running
pnpm dev                            # in a second terminal: app on :5173
```

`.dev.vars` sets the identity the local API treats you as. The API honours it
only for requests addressed to localhost, so do not put a dev server that has
it behind a tunnel or a proxy that rewrites the host to localhost.

## Tests

```bash
pnpm lint
pnpm test    # unit and integration tests (Vitest)
pnpm e2e     # browser tests (Playwright)
```

`pnpm test` includes the API handlers running against a real local database
and bucket, and the sync engine running between simulated devices.

`pnpm e2e` builds the app as it ships and drives it in a real browser, service
worker included, against the API on throwaway local state. It needs a browser
once: `pnpm exec playwright install chromium`.

## Deploy your own

A build without sync is static files: `pnpm build`, then host `dist/` anywhere.
Set `BASE_PATH=/subpath/` when it is not served from the root.

With sync, the app runs on Cloudflare (the free plans are enough):

1. Create a D1 database, an R2 bucket and a Pages project. Keep the bucket
   private: no public URL and no custom domain. Photos are meant to be reachable
   only through the API.
2. Put the site behind a Cloudflare Access application.
3. Replace every value in `wrangler.toml` with your own: the project name, the
   database name and id, the bucket name, and the Access team domain and
   audience tag. The ones in this repository belong to the author's
   deployment. They are identifiers, not credentials, but the two Access values
   decide whose sign-ins the API trusts. Left as they are, your API would trust
   the author's Access, not yours.
4. Set who may write: `pnpm exec wrangler pages secret put EDITOR_EMAIL`.
   Without it, everyone who is let in is read-only.
5. Apply the schema and deploy:

   ```bash
   pnpm exec wrangler d1 migrations apply <database> --remote
   VITE_SYNC=1 pnpm build
   pnpm exec wrangler pages deploy dist --project-name <project> --branch main
   ```

With the Access values empty, the API refuses every request. That is
deliberate.

In this repository, merging to `main` deploys, and releases are tagged from the
commit history. `CLAUDE.md` describes that flow and the rules the code follows.

## Your data

The export file is the only copy of your data you hold outside the app. Local
storage can be cleared by the browser, and a phone can be lost. Export from the
Backup menu and keep the file somewhere safe.

## License

MIT. See `LICENSE`.
