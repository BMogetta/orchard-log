-- Sync store for the optional cloud backend. One row per app document
-- (tree:*, event:*, settings:*), keyed by the same id the device uses locally.
-- `seq` is a server-assigned, strictly increasing change number: devices pull
-- "everything after the last seq I saw". Deletions stay as tombstone rows
-- (deleted = 1) so they propagate to other devices.
CREATE TABLE docs (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE UNIQUE INDEX docs_seq ON docs (seq);

-- Single-row counter backing `seq`.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT INTO meta (key, value) VALUES ('seq', 0);
