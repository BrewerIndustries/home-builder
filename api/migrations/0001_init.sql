-- Home Builder accounts + project library (D1 / SQLite). Project JSON lives in R2.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  display_name  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- HMAC-SHA256(token, SESSION_SECRET)
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_failures (
  key TEXT NOT NULL,                    -- 'ip:<addr>' or 'email:<addr>'
  at  INTEGER NOT NULL
);
CREATE INDEX idx_login_failures ON login_failures(key, at);

-- Single-use sign-up codes. Admins mint them in the app or with `npm run invite`.
CREATE TABLE invites (
  code       TEXT PRIMARY KEY,
  created_by TEXT,
  note       TEXT,
  created_at INTEGER NOT NULL,
  used_by    TEXT,
  used_at    INTEGER
);

CREATE TABLE projects (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_projects_user ON projects(user_id, updated_at DESC);
