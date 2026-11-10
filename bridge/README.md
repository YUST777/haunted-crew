# Haunted Crew bridge

Receives Kiro hook events and streams them to the Minecraft mod and the dashboard.

```
Kiro hooks ──POST /event (ingest token)──► bridge ──WS /stream (view token)──► mod, dashboard
```

## Run

```bash
npm install
node bin/haunted-crew.mjs [project] [--demo] [--port 8787] [--host 127.0.0.1] [--no-hooks] [--trust-all-tools] [--worktrees]
npm test
```

The launcher installs the Kiro hooks into the project, checks `kiro-cli whoami`, starts the bridge,
writes `~/.haunted-crew/bridge.json` (so Minecraft on the same PC and OS user connects with no setup)
and prints a pairing code for servers elsewhere. `--demo` swaps `kiro-cli acp` for `bin/demo-agent.mjs`.
`bin/bridge.mjs` is the bare bridge (env-configured) for custom setups.

On first start it creates `~/.haunted-crew/tokens.json` (mode 600):

| Token | Who uses it | Can |
|---|---|---|
| `ingest` | Kiro hooks (`bin/send-event.mjs`) | post events, and view |
| `command` | the Minecraft server (ops' console actions) | start / prompt agents, answer approvals, Kiro sign-in, and view |
| `view` | Minecraft mod, friends | view only |

Env overrides: `HOST`, `PORT`, `HAUNTED_CREW_HOME`, `HAUNTED_CREW_INGEST_TOKEN`, `HAUNTED_CREW_COMMAND_TOKEN`,
`HAUNTED_CREW_VIEW_TOKEN`, `HAUNTED_CREW_URL` (sender target), `HAUNTED_CREW_DEBUG=1` (sender errors),
`HAUNTED_CREW_KIRO_CLI` (path to kiro-cli), and for `bin/bridge.mjs`: `HAUNTED_CREW_WORKSPACE`
(enables console agents), `HAUNTED_CREW_TRUST_ALL_TOOLS=1`.

## API

| Route | Auth | Notes |
|---|---|---|
| `GET /healthz` | none | `{ ok: true }` |
| `POST /event` | `Authorization: Bearer <ingest>` | Raw Kiro hook JSON. Trigger from `X-Kiro-Trigger` header or `hook_event_name`. Max 1 MB. Returns `202 { id }`. |
| `GET /state` | Bearer `<view>` or `?token=` | `{ sessions, history }` |
| `WS /stream` | Bearer `<view>` or `?token=` | First message `{ type: "hello", role, sessions, history }`, then `{ type: "event", event, session }` |

| `GET /agents` | view | Console agents: `{ enabled, agents }` |
| `POST /agents` | command | `{ name }` → starts a `kiro-cli acp` session |
| `POST /agents/:session/prompt` | command | `{ text }` (queued while busy) |
| `POST /agents/:session/permission` | command | `{ requestId, optionId }` (`null` = deny) |
| `POST /pair` | pairing code | `{ code }` → `{ view, command }`; single use, 10 min |
| `GET /kiro/status` | view | `{ signedIn, installed, user }` via `kiro-cli whoami` |
| `POST /kiro/login` | command | starts `kiro-cli login --use-device-flow`, returns `{ url, code }` |

| `GET /api/workflows`, `POST /api/workflows/:id/run`, `GET /api/workflows/runs/:id` | view / command | Workflows, runs and their steps. |
| `GET /api/merges`, `GET /api/merges/:run/diff` | view | Runs waiting for approval (needs `--worktrees`) and their diff. |
| `POST /api/merges/:run/answer` | command | `{ option: "Merge" \| "Reject" \| "Request changes", text }`. |
| `GET /api/history/search`, `/api/skills`, `/api/routines`, `/api/channels`, `/api/backup` | view / command | History, skills, routines (`every 30m`, `daily 09:00`, webhooks), channels, backup. |
| `GET /kiro/usage` | command | Kiro credits used / total, plan, reset date (`kiro-cli /usage`, cached 60 s). |
| `POST /browser/{open,click,type,key,scroll,back,forward,reload}` | command | Drive the shared headless Chrome (keys include `Control+a`, `Shift+Tab`). |
| `POST /hooks/:id` | HMAC signature | Webhook routine trigger. |
| `GET /tools`, `POST /tools/call` | per-agent session token | The crew MCP tools (`bin/crew-mcp.mjs`). |

Failed auth and wrong pairing codes are limited to 20 attempts per minute per IP (then `429`).

### Console agents (ACP)

`src/acp.mjs` speaks the [Agent Client Protocol](https://agentclientprotocol.com) to `kiro-cli acp`.
Tool calls become `tool_start` / `tool_end` events, permission requests become `permission` events the
console answers, and the agent's reply becomes a `message` event (capped at 600 chars). The client
advertises no file system or terminal capabilities, so the agent uses its own tools in the project folder.

### Mod authentication

The mod connects to `ws://<bridge>/stream` with header `Authorization: Bearer <view token>`.
The server admin puts the view token in the mod's server config; it never goes to clients' chat or the in-game screen.
The in-game screen (a browser) cannot send headers, so it uses `?token=<view token>`: read-only, safe to share with players who can already see the screen.

### Event shape

```json
{ "id": "uuid", "ts": 1793749715886, "kind": "tool_start", "session": "abc",
  "agent": "optional", "tool": "read_file", "category": "read", "file": "src/x.ts",
  "ok": false, "task": "optional spec task title" }
```

`kind`: `session_start`, `session_end`, `prompt`, `stop`, `tool_start`, `tool_end`, `file_create`, `file_save`, `file_delete`, `task_start`, `task_end`, and for console agents `message`, `permission`, `permission_resolved`, `error`.
`category`: `read`, `write`, `shell`, `web`, `mcp`, `subagent`, `spec`, `other`.
Session `status` (ghost glow): `working` (blue), `waiting` (yellow), `error` (red), `idle` (grey).

**Privacy:** for hook events, prompts, file contents, tool input and tool output are dropped and paths are made relative to the project. Console agents carry your prompt and the agent's short reply, since that is the chat.

## Security notes

- Default bind is `127.0.0.1`. For multiplayer, bind `HOST=0.0.0.0` behind a TLS reverse proxy (e.g. Caddy) so tokens are not sent in clear text.
- `send-event.mjs` always exits 0 and prints nothing: exit 2 would block Kiro's tool call, and stdout would be injected into the agent's context.
- Kiro Crew hooks live in `~/.kiro/crew/hooks.json`; point their command at `node <path>/bin/send-event.mjs` (the trigger comes from `KIROCREW_HOOK_EVENT`).
