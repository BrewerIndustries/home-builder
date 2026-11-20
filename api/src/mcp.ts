import { actionTypes, ApiError, createProject, editProject, listProjects, projectReport, rollback, type Env } from './plans';
import type { ApiUser } from './v1';

// A small MCP server (JSON-RPC 2.0 over Streamable HTTP, stateless: every POST
// gets a JSON reply, no SSE). Connect an MCP client (Claude, ChatGPT, Cursor…)
// to https://<api host>/mcp with the header `Authorization: Bearer hb_…`.

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'list_projects',
    description: 'List the Home Builder projects saved to this account (id, name, updated_at). Projects kept only on a device ("This device") are not reachable — save them to the account in the app first.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_plan',
    description:
      'Read a project as a compact plan: walls (id, a/b end points, kind, length, height), openings, rooms (id, name, type, sq ft, outline), fixtures/furniture, outlets, lights and saved versions. Units are inches; x runs right, y runs DOWN the plan. Read this before editing so you use real ids and coordinates.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'] },
  },
  {
    name: 'get_report',
    description: 'The numbers the app shows: "estimate" (priced materials, totals by category), "checks" (IRC / NEC code checks: pass / fail / warn), or "materials" (the takeoff without prices).',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, report: { type: 'string', enum: ['estimate', 'checks', 'materials'] } }, required: ['project_id', 'report'] },
  },
  {
    name: 'list_action_types',
    description: 'The edit actions apply_actions accepts, with their fields.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'apply_actions',
    description:
      'Edit a plan with a batch of actions, e.g. [{"type":"updateWall","id":"w_…","patch":{"height":144}}] or [{"type":"addWalls","walls":[{"a":{"x":0,"y":0},"b":{"x":240,"y":0},"kind":"interior"}]}]. All or nothing: a bad action rejects the whole batch. Ids, wall thickness and default sizes are filled in when left out. The plan as it was is saved as a version first; the reply gives its version_id for rollback. Pass base_updated_at (from get_plan / list_projects) to refuse the edit if the project changed in between.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        actions: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] } },
        base_updated_at: { type: 'number' },
      },
      required: ['project_id', 'actions'],
    },
  },
  {
    name: 'rollback',
    description: 'Put a project back as it was in one of its saved versions (for example the version_id apply_actions returned).',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, version_id: { type: 'string' } }, required: ['project_id', 'version_id'] },
  },
  {
    name: 'create_project',
    description: 'Make a new, empty project in the account.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
];

const WRITES = new Set(['apply_actions', 'rollback', 'create_project']);

async function callTool(env: Env, u: ApiUser, name: string, a: Record<string, any>): Promise<unknown> {
  if (WRITES.has(name) && u.scope !== 'write') throw new ApiError(403, 'this token is read-only — make a read-write token in the app to edit plans');
  const id = String(a.project_id ?? '');
  switch (name) {
    case 'list_projects':
      return { projects: await listProjects(env, u.id) };
    case 'get_plan': {
      const r = await projectReport(env, u.id, id, 'summary');
      return { project: r.project, plan: r.report };
    }
    case 'get_report':
      return projectReport(env, u.id, id, String(a.report ?? ''));
    case 'list_action_types':
      return { actions: actionTypes(), notes: 'Inches; y runs down the plan. Openings sit `offset` inches from the wall\'s a end to their centre.' };
    case 'apply_actions':
      return editProject(env, u.id, id, a.actions, u.label, a.base_updated_at);
    case 'rollback':
      return rollback(env, u.id, id, String(a.version_id ?? ''));
    case 'create_project':
      return { project: await createProject(env, u.id, String(a.name ?? 'Untitled')) };
  }
  throw new ApiError(404, `unknown tool "${name}"`);
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

async function one(env: Env, u: ApiUser, m: Rpc): Promise<unknown | null> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: m.id ?? null, result });
  const error = (code: number, message: string) => ({ jsonrpc: '2.0', id: m.id ?? null, error: { code, message } });
  if (!m || typeof m !== 'object' || typeof m.method !== 'string') return error(-32600, 'invalid request');
  const notification = m.id === undefined;
  switch (m.method) {
    case 'initialize': {
      const asked = m.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'home-builder', version: '1.0.0' },
        instructions:
          'Home Builder floor plans. Start with list_projects, then get_plan. Edit with apply_actions (see list_action_types); every edit saves a version you can rollback to. Check the result with get_report (estimate / checks). Units are inches, y runs down the plan.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = String(m.params?.name ?? '');
      try {
        const result = await callTool(env, u, name, m.params?.arguments ?? {});
        return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'server error';
        if (!(e instanceof ApiError)) console.error(e);
        return reply({ content: [{ type: 'text', text: msg }], isError: true });
      }
    }
    default:
      if (notification) return null; // notifications/initialized and friends
      return error(-32601, `method not found: ${m.method}`);
  }
}

/** One JSON-RPC message or a batch; null when there's nothing to answer (only notifications). */
export async function handleMcp(env: Env, u: ApiUser, body: unknown): Promise<unknown | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => one(env, u, m)))).filter((x) => x !== null);
    return out.length ? out : null;
  }
  if (!body || typeof body !== 'object') return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } };
  return one(env, u, body as Rpc);
}
