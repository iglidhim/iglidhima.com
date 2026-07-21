-- Family Corner: submissions index migration.
-- Applied by the owner via `npx wrangler d1 migrations apply family-corner`
-- (local and/or remote). LOCAL-ONLY here; do not run against remote D1
-- unless the owner intends to.

CREATE TABLE submissions (
  id          TEXT PRIMARY KEY,            -- UUID v4 generated in the Worker
  sender      TEXT NOT NULL,               -- 'Kian' | 'Eloise' (validated before insert)
  created_at  INTEGER NOT NULL,            -- epoch milliseconds (UTC)
  has_note    INTEGER NOT NULL DEFAULT 0,  -- 0|1
  note_text   TEXT,                        -- NULL when has_note = 0; <= 500 chars
  has_image   INTEGER NOT NULL DEFAULT 0,  -- 0|1
  r2_key      TEXT                         -- R2 object key when has_image = 1, else NULL
);

CREATE INDEX idx_submissions_created_at ON submissions (created_at DESC);
