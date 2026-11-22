// D1-backed document store for device sync. Devices keep working against their
// local database; this is the shared copy they push to and pull from.

export {
  canonicalBody,
  SYNCED_ID,
  MAX_DOCS_PER_PUSH,
  MAX_DOC_CHARS,
  MAX_PUSH_CHARS,
  MAX_PHOTO_BYTES,
  PHOTO_PREFIX,
  isPhotoId,
  sniffImageType,
} from "../shared/sync.js";

export const CHANGES_PAGE_SIZE = 200;
// A page also stops once it carries this much document text, so a run of large
// documents cannot produce a response too big for a device to pull.
export const CHANGES_PAGE_CHARS = 1_000_000;

// Changes after `since`, oldest first, one page at a time.
export async function readChanges(db, since, limit = CHANGES_PAGE_SIZE) {
  const { results } = await db
    .prepare("SELECT id, seq, deleted, body FROM docs WHERE seq > ? ORDER BY seq LIMIT ?")
    .bind(since, limit + 1)
    .all();
  const page = [];
  let chars = 0;
  for (const row of results.slice(0, limit)) {
    if (page.length && chars + row.body.length > CHANGES_PAGE_CHARS) break;
    page.push(row);
    chars += row.body.length;
  }
  return {
    docs: page.map((row) => ({
      id: row.id,
      seq: row.seq,
      deleted: row.deleted === 1,
      doc: row.deleted === 1 ? null : JSON.parse(row.body),
    })),
    lastSeq: page.length ? page.at(-1).seq : since,
    more: results.length > page.length,
  };
}

// Upserts `docs` ([{ id, deleted, body }], body already canonical) in one
// transaction. Last write wins; a write identical to the stored row is skipped
// and keeps its old seq. Returns how many rows actually changed.
export async function writeDocs(db, docs, email) {
  const now = new Date().toISOString();
  const bump = db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'seq'");
  const upsert = db.prepare(
    `INSERT INTO docs (id, seq, deleted, body, updated_at, updated_by)
     VALUES (?1, (SELECT value FROM meta WHERE key = 'seq'), ?2, ?3, ?4, ?5)
     ON CONFLICT (id) DO UPDATE SET
       seq = excluded.seq,
       deleted = excluded.deleted,
       body = excluded.body,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by
     WHERE docs.body != excluded.body OR docs.deleted != excluded.deleted`
  );

  const statements = [];
  for (const doc of docs) {
    statements.push(bump, upsert.bind(doc.id, doc.deleted ? 1 : 0, doc.body, now, email));
  }
  const results = await db.batch(statements);

  let written = 0;
  for (let i = 1; i < results.length; i += 2) written += results[i].meta.changes;
  return { written };
}
