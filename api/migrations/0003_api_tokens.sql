-- Personal API tokens: a user plugs their own AI (MCP client, script) into their
-- projects. Only HMAC-SHA256(token, SESSION_SECRET) is stored; the token is
-- shown once when made. scope: 'read' (look only) or 'write' (edit plans).
CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  scope        TEXT NOT NULL DEFAULT 'write' CHECK (scope IN ('read','write')),
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

-- Per-token request log for rate limiting (rows older than a minute are pruned).
CREATE TABLE api_hits (
  token_id TEXT NOT NULL,
  at       INTEGER NOT NULL
);
CREATE INDEX idx_api_hits ON api_hits(token_id, at);
