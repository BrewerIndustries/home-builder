import type { Project } from './types.ts';

// Client for the accounts / project-library Worker in api/. The build sets
// VITE_API_BASE; local dev talks to `wrangler dev` on :8787.

export const API_BASE: string = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

export interface User {
  id: string;
  email: string;
  role: 'user' | 'admin';
  display_name: string | null;
}

export interface CloudProject {
  id: string;
  name: string;
  bytes: number;
  created_at: number;
  updated_at: number;
}

export interface Invite {
  code: string;
  note: string | null;
  created_at: number;
  used_at: number | null;
  used_by_email: string | null;
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.error ?? `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      ...init,
      credentials: 'include',
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new ApiError(0, { error: 'Can’t reach the Home Builder server — check your connection.' });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const post = (path: string, body: unknown) => ({ method: 'POST', body: JSON.stringify(body) }) as RequestInit;

export const cloud = {
  me: () => api<{ user: User | null }>('/auth/me').then((r) => r.user),
  login: (email: string, password: string) => api<{ user: User }>('/auth/login', post('', { email, password })).then((r) => r.user),
  signup: (code: string, email: string, password: string, display_name: string) =>
    api<{ user: User }>('/auth/signup', post('', { code, email, password, display_name })).then((r) => r.user),
  logout: () => api('/auth/logout', { method: 'POST' }),
  changePassword: (current: string, next: string) => api('/auth/password', post('', { current, next })),

  list: () => api<{ projects: CloudProject[] }>('/projects').then((r) => r.projects),
  get: (id: string) => api<{ project: CloudProject; data: Project }>(`/projects/${encodeURIComponent(id)}`),
  /** Save; throws ApiError 409 if the server copy is newer than `base` (unless force). */
  put: (id: string, data: Project, base: number | undefined, force = false) =>
    api<{ project: CloudProject }>(`/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ name: data.name, data, base: base ?? 0, force }),
    }).then((r) => r.project),
  remove: (id: string) => api(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  invites: () => api<{ invites: Invite[] }>('/invites').then((r) => r.invites),
  invite: (note: string) => api<{ code: string }>('/invites', post('', { note })).then((r) => r.code),
  revokeInvite: (code: string) => api(`/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),
};

/** Shareable sign-up link for an invite code. */
export function inviteLink(code: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}?invite=${encodeURIComponent(code)}`;
}
