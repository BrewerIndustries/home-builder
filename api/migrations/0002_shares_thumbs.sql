-- Read-only share links and plan thumbnails.

-- Small SVG of the plan, made by the app on save (src/model/thumbnail.ts); ≤ 6 KB.
ALTER TABLE projects ADD COLUMN thumb TEXT;

-- One live read-only link per project. Only the token's SHA-256 is stored; the
-- owner sees the link when it's made and can revoke or replace it.
CREATE TABLE shares (
  token_hash TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_shares_user ON shares(user_id);
