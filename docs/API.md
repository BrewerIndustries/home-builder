# Home Builder API + MCP (connect your AI)

Hosts: dev `https://homebuilder-api-dev.dabrewer.dev`, prod `https://homebuilder-api.dabrewer.dev`.
It reaches the projects saved to your **account**. Projects kept only in a browser ("This device") aren't reachable; move them to the account in the Projects dialog first.

## Tokens
To make a token in the app: **Account → Connect your AI → Create token**. A token is either *Read + edit* or *Read only*.
- The token (`hb_…`) is shown once. Only its HMAC is stored.
- Send it as `Authorization: Bearer hb_…`.
- Limits: 120 requests a minute per token, 20 tokens per account.
- Tokens can't make tokens; that needs the signed-in app.

## MCP
Add a remote MCP server in your AI app:
- URL: `<host>/mcp`
- Header: `Authorization: Bearer hb_…`

It is stateless JSON-RPC over Streamable HTTP (POST only, no SSE).

| Tool | What it does |
|---|---|
| `list_projects` | Your account's projects (id, name, updated_at). |
| `get_plan` | A compact plan: walls (ids, end points, kind, length, height), openings, rooms, fixtures, outlets, lights, versions. |
| `get_report` | `estimate` / `checks` / `materials`: the same numbers as the Estimate and Code check tabs. |
| `list_action_types` | The edit actions and their fields. |
| `apply_actions` | A batch of edits, all or nothing. Saves a "Before API edit" version first and returns its `versionId`. Optional `base_updated_at` refuses the edit if the project changed in between. |
| `rollback` | Restore a version. |
| `create_project` | A new empty project. |

Units are inches. Plan x runs right, y runs **down**. Openings sit `offset` inches from their wall's `a` end to their centre.

## REST (same engine)
```
GET  /v1                         service info + action list
GET  /v1/actions                 action list
GET  /v1/projects                list
POST /v1/projects                {name}  → new project
GET  /v1/projects/:id            {project, data} (the full project JSON)
GET  /v1/projects/:id/summary    the compact plan (as get_plan)
GET  /v1/projects/:id/estimate | checks | materials
POST /v1/projects/:id/actions    {actions:[…], base?}  → {updated_at, applied, changed, versionId}
POST /v1/projects/:id/rollback   {version_id}
```

## Examples
Every wall to 12 ft:
```json
{"actions":[{"type":"updateWall","id":"w_…","patch":{"height":144}}, …]}
```
A 10' interior wall, a 3' doorway in it, and an arched opening on another wall:
```json
{"actions":[
  {"type":"addWalls","walls":[{"id":"w_new","a":{"x":0,"y":120},"b":{"x":120,"y":120},"kind":"interior"}]},
  {"type":"addOpening","opening":{"wallId":"w_new","kind":"door","offset":60}},
  {"type":"addOpening","opening":{"wallId":"w_…","kind":"door","operation":"open","offset":48,"width":60,"height":96,"arch":18}}
]}
```

## How it works
- `src/api/engine.ts` is pure TypeScript shared with the app. It runs each action through the app's own reducer (`historyReducer`), so the same rules hold, and it fills in ids, wall thickness and default sizes.
- The Worker modules: `api/src/plans.ts` loads and saves the project in R2 + D1, keeping the same rows the app uses. `api/src/v1.ts` holds the tokens and REST routes, and `api/src/mcp.ts` the MCP server.
- An edit bumps `updated_at`. An app with the project open then gets its usual "changed elsewhere" conflict on its next save instead of overwriting the edit.
- API versions are capped at the last 10 per project.
