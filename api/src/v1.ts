import type { Hono } from 'hono';
import { newToken, sessionId } from './auth';
import { handleMcp } from './mcp';
import { actionTypes, ApiError, createProject, editProject, listProjects, loadProject, projectReport, rollback, type Env } from './plans';

// The public API: personal access tokens (made in the app, signed in), a REST
// API under /v1 and an MCP server at /mcp, so a user can plug their own AI into
// their projects. A token is "hb_" + 43 random characters, sent as
// `Authorization: Bearer hb_…`; D1 keeps only its HMAC.

export type ApiUser = { id: string; scope: 'read' | 'write'; tokenId: string | null; label: string };

type Deps = {
  /** The signed-in user from the session cookie (index.ts), or null. */
  currentUser(c: any): Promise<{ id: string } | null>;
};

const RATE_PER_MIN = 120;
const MAX_TOKENS = 20;

/** Who's calling: a Bearer token, else the app's session cookie (full access). */
export async function apiUser(c: any, deps: Deps): Promise<ApiUser | null> {
  const h = c.req.header('Authorization') ?? '';
  const m = /^Bearer\s+(hb_[A-Za-z0-9_-]{43})$/.exec(h.trim());
  if (m) {
    const hash = await sessionId(m[1], c.env.SESSION_SECRET);
    const row = await c.env.DB.prepare('SELECT id, user_id, name, scope FROM api_tokens WHERE token_hash = ?').bind(hash).first();
    if (!row) return null;
    const now = Date.now();
    // Rate limit per token, and note when it was last used.
    await c.env.DB.prepare('DELETE FROM api_hits WHERE at < ?').bind(now - 60_000).run();
    const hits = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM api_hits WHERE token_id = ?').bind(row.id).first();
    if (Number(hits?.n ?? 0) >= RATE_PER_MIN) throw new ApiError(429, `rate limit: ${RATE_PER_MIN} requests a minute per token`);
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO api_hits (token_id, at) VALUES (?, ?)').bind(row.id, now),
      c.env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(now, row.id),
    ]);
    return { id: row.user_id as string, scope: row.scope as 'read' | 'write', tokenId: row.id as string, label: `token "${row.name}"` };
  }
  if (h) return null;
  const u = await deps.currentUser(c);
  return u ? { id: u.id, scope: 'write', tokenId: null, label: 'app session' } : null;
}

export function requireWrite(u: ApiUser) {
  if (u.scope !== 'write') throw new ApiError(403, 'this token is read-only — make a read-write token to edit plans');
}

export function registerV1(app: Hono<any>, deps: Deps) {
  const fail = (c: any, e: unknown) => {
    if (e instanceof ApiError) return c.json({ error: e.message }, e.status);
    console.error(e);
    return c.json({ error: 'server error' }, 500);
  };
  /** Run a handler as the API user, mapping errors to JSON. */
  const as = (fn: (c: any, u: ApiUser) => Promise<unknown>) => async (c: any) => {
    try {
      const u = await apiUser(c, deps);
      if (!u) return c.json({ error: 'send Authorization: Bearer <token> (make one in the app: account menu → API tokens)' }, 401);
      return c.json(await fn(c, u));
    } catch (e) {
      return fail(c, e);
    }
  };
  const env = (c: any): Env => c.env;

  // ---- tokens: managed in the app (session cookie only — a token can't make tokens) ----
  const session = async (c: any) => {
    const u = await deps.currentUser(c);
    if (!u) throw new ApiError(401, 'not signed in');
    return u;
  };
  app.get('/tokens', async (c) => {
    try {
      const u = await session(c);
      const { results } = await c.env.DB.prepare('SELECT id, name, scope, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC').bind(u.id).all();
      return c.json({ tokens: results });
    } catch (e) {
      return fail(c, e);
    }
  });
  app.post('/tokens', async (c) => {
    try {
      const u = await session(c);
      const b = await c.req.json().catch(() => ({}) as any);
      const name = String(b.name ?? '').trim().slice(0, 60) || 'My AI';
      const scope = b.scope === 'read' ? 'read' : 'write';
      const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?').bind(u.id).first();
      if (Number(n?.n ?? 0) >= MAX_TOKENS) throw new ApiError(403, `limit of ${MAX_TOKENS} tokens — revoke one first`);
      const token = `hb_${newToken()}`;
      const id = crypto.randomUUID();
      const now = Date.now();
      await c.env.DB.prepare('INSERT INTO api_tokens (id, user_id, name, token_hash, scope, created_at) VALUES (?,?,?,?,?,?)')
        .bind(id, u.id, name, await sessionId(token, c.env.SESSION_SECRET), scope, now)
        .run();
      return c.json({ token, id, name, scope, created_at: now });
    } catch (e) {
      return fail(c, e);
    }
  });
  app.delete('/tokens/:id', async (c) => {
    try {
      const u = await session(c);
      await c.env.DB.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').bind(c.req.param('id'), u.id).run();
      return c.json({ ok: true });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ---- REST ----
  app.get('/v1', (c) => c.json({ service: 'home-builder-api', version: 1, docs: 'GET /v1/actions lists the edit actions; MCP at /mcp', actions: actionTypes() }));
  app.get('/v1/actions', (c) => c.json({ actions: actionTypes() }));
  app.get('/v1/projects', as(async (c, u) => ({ projects: await listProjects(env(c), u.id) })));
  app.post(
    '/v1/projects',
    as(async (c, u) => {
      requireWrite(u);
      const b = await c.req.json().catch(() => ({}) as any);
      return { project: await createProject(env(c), u.id, String(b.name ?? 'Untitled')) };
    }),
  );
  app.get(
    '/v1/projects/:id',
    as(async (c, u) => {
      const { meta, data } = await loadProject(env(c), u.id, c.req.param('id'));
      return { project: meta, data };
    }),
  );
  app.get('/v1/projects/:id/:report{summary|estimate|checks|materials}', as(async (c, u) => projectReport(env(c), u.id, c.req.param('id'), c.req.param('report'))));
  app.post(
    '/v1/projects/:id/actions',
    as(async (c, u) => {
      requireWrite(u);
      const b = await c.req.json().catch(() => ({}) as any);
      return editProject(env(c), u.id, c.req.param('id'), b.actions, u.label, b.base);
    }),
  );
  app.post(
    '/v1/projects/:id/rollback',
    as(async (c, u) => {
      requireWrite(u);
      const b = await c.req.json().catch(() => ({}) as any);
      return rollback(env(c), u.id, c.req.param('id'), String(b.version_id ?? ''));
    }),
  );

  // ---- MCP (Streamable HTTP, stateless JSON responses) ----
  app.post('/mcp', async (c) => {
    let u: ApiUser | null;
    try {
      u = await apiUser(c, deps);
    } catch (e) {
      return fail(c, e);
    }
    if (!u) {
      c.header('WWW-Authenticate', 'Bearer realm="home-builder"');
      return c.json({ error: 'send Authorization: Bearer <token> (make one in the app: account menu → API tokens)' }, 401);
    }
    const body = await c.req.json().catch(() => null);
    const out = await handleMcp(env(c), u, body);
    if (out === null) return c.body(null, 202);
    return c.json(out);
  });
  app.get('/mcp', (c) => c.json({ error: 'POST JSON-RPC to this endpoint (stateless; no SSE stream)' }, 405));
  app.delete('/mcp', (c) => c.body(null, 405));
}
