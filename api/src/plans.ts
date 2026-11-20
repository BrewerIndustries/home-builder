import { ActionError, API_ACTIONS, applyActions, report, type ReportKind } from '../../src/api/engine.ts';
import { newProject } from '../../src/model/assembly.ts';
import { restoreVersion } from '../../src/model/versions.ts';
import { planThumbnail } from '../../src/model/thumbnail.ts';
import type { Project } from '../../src/model/types.ts';
import { cleanThumb } from './share';

// What the public API and the MCP server both do to a user's projects: list,
// read, create, edit with a batch of actions, report, roll back. Projects are
// the same rows / R2 objects the app saves (index.ts), so an edit here shows up
// in the app on its next load (an open copy gets the usual "changed elsewhere"
// conflict instead of overwriting it).

export type Env = { DB: D1Database; PROJECTS: R2Bucket };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const r2key = (userId: string, id: string) => `projects/${userId}/${id}.json`;
const MAX_PROJECTS = 200;
const MAX_BYTES = 20 * 1024 * 1024;

const meta = (row: any) => ({ id: row.id as string, name: row.name as string, updated_at: Number(row.updated_at), created_at: Number(row.created_at), bytes: Number(row.bytes) });

export async function listProjects(env: Env, userId: string) {
  const { results } = await env.DB.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').bind(userId).all();
  return results.map(meta);
}

export async function loadProject(env: Env, userId: string, id: string): Promise<{ meta: ReturnType<typeof meta>; data: Project }> {
  const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(id, userId).first();
  if (!row) throw new ApiError(404, `no project "${id}" — list_projects shows yours (only projects saved to your account are reachable; "This device" projects aren't)`);
  const obj = await env.PROJECTS.get(r2key(userId, id));
  if (!obj) throw new ApiError(404, 'project data missing');
  return { meta: meta(row), data: (await obj.json()) as Project };
}

async function store(env: Env, userId: string, id: string, data: Project, created?: number, prevUpdated = 0) {
  const body = JSON.stringify(data);
  if (body.length > MAX_BYTES) throw new ApiError(413, 'project would be larger than 20 MB');
  const now = Math.max(Date.now(), prevUpdated + 1);
  const name = String(data.name || 'Untitled').slice(0, 120);
  await env.PROJECTS.put(r2key(userId, id), body, { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare(
    `INSERT INTO projects (id, user_id, name, bytes, created_at, updated_at, thumb) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, bytes = excluded.bytes, updated_at = excluded.updated_at, thumb = excluded.thumb`,
  )
    .bind(id, userId, name, body.length, created ?? now, now, cleanThumb(planThumbnail(data)))
    .run();
  return { id, name, updated_at: now };
}

export async function createProject(env: Env, userId: string, name: string) {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').bind(userId).first();
  if (Number(n?.n ?? 0) >= MAX_PROJECTS) throw new ApiError(403, `limit of ${MAX_PROJECTS} projects reached`);
  const id = `prj_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  return store(env, userId, id, newProject(name.trim().slice(0, 120) || 'Untitled'));
}

/**
 * Apply a batch of actions. `base` (optional) is the updated_at the caller last
 * read: a newer saved copy means someone else changed it, so the batch is refused.
 */
export async function editProject(env: Env, userId: string, id: string, actions: unknown[], label: string, base?: number) {
  const { meta: m, data } = await loadProject(env, userId, id);
  if (base !== undefined && Number(base) < m.updated_at) throw new ApiError(409, `the project changed since you read it (updated_at ${m.updated_at}) — read it again and redo the edit`);
  let result;
  try {
    result = applyActions(data, actions, label);
  } catch (e) {
    if (e instanceof ActionError) throw new ApiError(400, e.message);
    throw e;
  }
  if (!result.versionId) return { ...m, applied: result.applied, changed: false, versionId: null };
  const saved = await store(env, userId, id, result.project, m.created_at, m.updated_at);
  return { ...saved, applied: result.applied, changed: true, versionId: result.versionId };
}

/** Put the plan back as it was in a version (e.g. the "Before API edit" one an edit returned). */
export async function rollback(env: Env, userId: string, id: string, versionId: string) {
  const { meta: m, data } = await loadProject(env, userId, id);
  if (!data.versions?.some((v) => v.id === versionId)) throw new ApiError(404, `no version "${versionId}" in this project`);
  return store(env, userId, id, restoreVersion(data, versionId), m.created_at, m.updated_at);
}

const KINDS: ReportKind[] = ['summary', 'estimate', 'checks', 'materials'];

export async function projectReport(env: Env, userId: string, id: string, kind: string) {
  if (!KINDS.includes(kind as ReportKind)) throw new ApiError(400, `report must be one of ${KINDS.join(', ')}`);
  const { meta: m, data } = await loadProject(env, userId, id);
  return { project: m, report: report(data, kind as ReportKind) };
}

export const actionTypes = () => API_ACTIONS;
