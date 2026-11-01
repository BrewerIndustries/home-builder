import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { hashPassword, newToken, sessionId, verifyPassword } from './auth';

// Home Builder API: invite-only accounts and a per-user project library.
// Project metadata lives in D1; each project's JSON (which can carry an
// underlay image) is an object in a private R2 bucket at projects/<user>/<id>.json.

type Bindings = {
  DB: D1Database;
  PROJECTS: R2Bucket;
  ALLOWED_ORIGIN: string;
  SESSION_SECRET: string;
};

type SessionUser = { id: string; email: string; role: 'user' | 'admin'; display_name: string | null };

const app = new Hono<{ Bindings: Bindings; Variables: { user: SessionUser } }>();

const COOKIE = 'hb_session';
const SESSION_DAYS = 60;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
const MAX_PROJECT_BYTES = 20 * 1024 * 1024;
const MAX_PROJECTS = 200;

app.use(
  '*',
  cors({
    origin: (origin, c) => {
      if (origin === c.env.ALLOWED_ORIGIN) return origin;
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '')) return origin;
      return c.env.ALLOWED_ORIGIN;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

// ---------------- helpers ----------------
function publicUser(row: any): SessionUser {
  return { id: row.id, email: row.email, role: row.role, display_name: row.display_name ?? null };
}

async function currentUser(c: any): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const id = await sessionId(token, c.env.SESSION_SECRET);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.display_name, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
  )
    .bind(id)
    .first();
  if (!row || Number(row.expires_at) < Date.now()) return null;
  return publicUser(row);
}

const auth = async (c: any, next: any) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'not signed in' }, 401);
  c.set('user', user);
  await next();
};

const requireAdmin = async (c: any, next: any) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'admins only' }, 403);
  await next();
};

async function startSession(c: any, userId: string) {
  const token = newToken();
  const created = Date.now();
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .bind(await sessionId(token, c.env.SESSION_SECRET), userId, created, created + SESSION_MS)
    .run();
  const host = new URL(c.req.url).hostname;
  const secure = host !== 'localhost' && host !== '127.0.0.1';
  setCookie(c, COOKIE, token, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 24 * 60 * 60 });
}

function validLogin(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /^[a-z0-9._-]{3,32}$/.test(email);
}

function inviteCode(): string {
  // 12 chars from an unambiguous alphabet, grouped for reading aloud: ABCD-EFGH-JKLM
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(12));
  const s = [...r].map((b) => abc[b % abc.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

const r2key = (userId: string, id: string) => `projects/${userId}/${id}.json`;

function publicProject(row: any) {
  return { id: row.id, name: row.name, bytes: row.bytes, created_at: row.created_at, updated_at: row.updated_at };
}

// ---------------- auth ----------------
app.get('/', (c) => c.json({ ok: true, service: 'home-builder-api' }));

app.post('/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) return c.json({ error: 'email and password required' }, 400);

  const ip = c.req.header('CF-Connecting-IP') || 'unknown';
  const keys = [`ip:${ip}`, `email:${email}`];
  const since = Date.now() - LOGIN_WINDOW_MS;
  await c.env.DB.prepare('DELETE FROM login_failures WHERE at < ?').bind(since).run();
  const fails = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM login_failures WHERE key IN (?, ?) AND at >= ? GROUP BY key ORDER BY n DESC LIMIT 1',
  )
    .bind(keys[0], keys[1], since)
    .first();
  if (Number(fails?.n ?? 0) >= LOGIN_MAX_FAILURES) return c.json({ error: 'too many attempts — try again in 15 minutes' }, 429);

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user || !(await verifyPassword(password, user.password_hash as string))) {
    const at = Date.now();
    await c.env.DB.batch(keys.map((k) => c.env.DB.prepare('INSERT INTO login_failures (key, at) VALUES (?, ?)').bind(k, at)));
    return c.json({ error: 'wrong email or password' }, 401);
  }
  await startSession(c, user.id as string);
  return c.json({ user: publicUser(user) });
});

// Sign up with a single-use invite code.
app.post('/auth/signup', async (c) => {
  const b = await c.req.json().catch(() => ({}) as any);
  const code = String(b.code ?? '').trim().toUpperCase();
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = String(b.password ?? '');
  const name = b.display_name ? String(b.display_name).trim().slice(0, 80) : null;
  if (!validLogin(email)) return c.json({ error: 'use an email address' }, 400);
  if (password.length < 10) return c.json({ error: 'password must be at least 10 characters' }, 400);

  const invite = await c.env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(code).first();
  if (!invite || invite.used_by) return c.json({ error: 'that invite code is not valid (or was already used)' }, 403);
  if (await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) {
    return c.json({ error: 'that email already has an account — sign in instead' }, 409);
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  // Claim the code atomically so two people can't share one.
  const claim = await c.env.DB.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL').bind(id, now, code).run();
  if (!claim.meta.changes) return c.json({ error: 'that invite code was just used' }, 403);
  await c.env.DB.prepare('INSERT INTO users (id, email, password_hash, role, display_name, created_at) VALUES (?,?,?,?,?,?)')
    .bind(id, email, await hashPassword(password), 'user', name, now)
    .run();
  await startSession(c, id);
  return c.json({ user: { id, email, role: 'user', display_name: name } });
});

app.post('/auth/logout', async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sessionId(token, c.env.SESSION_SECRET)).run();
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/auth/me', async (c) => c.json({ user: await currentUser(c) }));

app.post('/auth/password', auth, async (c) => {
  const b = await c.req.json().catch(() => ({}) as any);
  const current = String(b.current ?? '');
  const next = String(b.next ?? '');
  if (next.length < 10) return c.json({ error: 'new password must be at least 10 characters' }, 400);
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(c.get('user').id).first();
  if (!row || !(await verifyPassword(current, row.password_hash as string))) return c.json({ error: 'current password is wrong' }, 401);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(next), c.get('user').id).run();
  return c.json({ ok: true });
});

// ---------------- invites (admin) ----------------
app.get('/invites', auth, requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.code, i.note, i.created_at, i.used_at, u.email AS used_by_email
     FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 100`,
  ).all();
  return c.json({ invites: results });
});

app.post('/invites', auth, requireAdmin, async (c) => {
  const b = await c.req.json().catch(() => ({}) as any);
  const code = inviteCode();
  const note = b.note ? String(b.note).slice(0, 120) : null;
  await c.env.DB.prepare('INSERT INTO invites (code, created_by, note, created_at) VALUES (?,?,?,?)').bind(code, c.get('user').id, note, Date.now()).run();
  return c.json({ code });
});

app.delete('/invites/:code', auth, requireAdmin, async (c) => {
  await c.env.DB.prepare('DELETE FROM invites WHERE code = ? AND used_by IS NULL').bind(c.req.param('code')).run();
  return c.json({ ok: true });
});

// ---------------- projects ----------------
app.get('/projects', auth, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').bind(c.get('user').id).all();
  return c.json({ projects: results.map(publicProject) });
});

app.get('/projects/:id', auth, async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(c.req.param('id'), user.id).first();
  if (!row) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.PROJECTS.get(r2key(user.id, row.id as string));
  if (!obj) return c.json({ error: 'project data missing' }, 404);
  return c.json({ project: publicProject(row), data: await obj.json() });
});

// Create or replace. `base` is the updated_at the client last saw; a newer server
// copy (saved from another device) answers 409 unless `force` is set.
app.put('/projects/:id', auth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return c.json({ error: 'bad project id' }, 400);
  const text = await c.req.text();
  if (text.length > MAX_PROJECT_BYTES) return c.json({ error: 'project is larger than 20 MB — try a smaller floorplan image' }, 413);
  let b: any;
  try {
    b = JSON.parse(text);
  } catch {
    return c.json({ error: 'body must be JSON' }, 400);
  }
  if (!b.data || typeof b.data !== 'object' || !Array.isArray(b.data.walls)) return c.json({ error: 'not a Home Builder project' }, 400);
  const name = String(b.name ?? b.data.name ?? 'Untitled').slice(0, 120) || 'Untitled';

  const row = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (row && row.user_id !== user.id) return c.json({ error: 'not found' }, 404);
  if (row && !b.force && Number(b.base ?? 0) < Number(row.updated_at)) {
    return c.json({ error: 'conflict', project: publicProject(row) }, 409);
  }
  if (!row) {
    const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').bind(user.id).first();
    if (Number(n?.n ?? 0) >= MAX_PROJECTS) return c.json({ error: `limit of ${MAX_PROJECTS} projects reached` }, 403);
  }
  const body = JSON.stringify(b.data);
  const now = Math.max(Date.now(), Number(row?.updated_at ?? 0) + 1);
  await c.env.PROJECTS.put(r2key(user.id, id), body, { httpMetadata: { contentType: 'application/json' } });
  await c.env.DB.prepare(
    `INSERT INTO projects (id, user_id, name, bytes, created_at, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, bytes = excluded.bytes, updated_at = excluded.updated_at`,
  )
    .bind(id, user.id, name, body.length, Number(row?.created_at ?? now), now)
    .run();
  return c.json({ project: { id, name, bytes: body.length, created_at: Number(row?.created_at ?? now), updated_at: now } });
});

app.patch('/projects/:id', auth, async (c) => {
  const b = await c.req.json().catch(() => ({}) as any);
  const name = String(b.name ?? '').trim().slice(0, 120);
  if (!name) return c.json({ error: 'name required' }, 400);
  const res = await c.env.DB.prepare('UPDATE projects SET name = ? WHERE id = ? AND user_id = ?').bind(name, c.req.param('id'), c.get('user').id).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

app.delete('/projects/:id', auth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  await c.env.PROJECTS.delete(r2key(user.id, id));
  return c.json({ ok: true });
});

export default app;
