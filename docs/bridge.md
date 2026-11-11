# Bridge modules

All files are in `bridge/src/`. The HTTP routes are listed in [bridge/README.md](../bridge/README.md).

| Module | Role |
|---|---|
| `server.mjs` | HTTP + WebSocket server, auth, rate limiting, all routes, the three web pages. |
| `acp.mjs` | JSON-RPC over stdio to `kiro-cli acp`: requests, notifications, permission callbacks. |
| `agents.mjs` | Agent manager: process pool, spare sessions, queues, models, approvals, interrupt, pause, git sandbox env, per-run working folder. |
| `normalize.mjs` | Turns hook payloads and ACP updates into one privacy-safe event shape. |
| `state.mjs` | Live session table and event history. |
| `workflows.mjs` | Workflow graphs, templates, lead delegation, parallel execution, run lifecycle, merge proposals. |
| `worktrees.mjs` | Per-run git worktree and branch, diff summary, off-tree merge, discard. |
| `tools.mjs` | The `crew` MCP tools and mid-turn `[NEW MESSAGES]` delivery. `bin/crew-mcp.mjs` is the stdio server. |
| `mailbox.mjs` | Agent-to-agent and user-to-agent messages with reply tracking. |
| `memory.mjs` | Per-agent long-term memory injected into the next prompt. |
| `shared-data.mjs` | Shared SQLite database; agents may only change tables they own. |
| `history.mjs` | Searchable history of everything the crew did. |
| `compaction.mjs` | Context estimate (about 4 characters per token) and compaction hints. |
| `routines.mjs` | `every 30m`, `daily 09:00` and HMAC-signed webhook triggers for workflows. |
| `channels.mjs` | Named group chats between agents and people. |
| `skillstore.mjs` | Loads `SKILL.md` from `.kiro/skills/`, `skills/`, `.claude/skills/`. |
| `edits.mjs` | Captures file edits for the live-code screen with diffs. |
| `browser.mjs` | Shared headless Chrome: screencast frames, input, per-host zoom. |
| `backup.mjs` | Backup and restore of saved crew state with secrets stripped. |
| `pairing.mjs`, `auth.mjs` | Single-use pairing codes, the three tokens, constant-time compare. |
| `kiro.mjs` | `kiro-cli whoami`, device-flow login, usage and credits. |
| `runstore.mjs`, `config.mjs` | Run persistence and bridge configuration under `.haunted-crew/`. |

## Launcher

`node bin/haunted-crew.mjs <project> [--worktrees] [--demo] [--trust-all-tools] [--mcp] [--host H] [--port P]`

It installs Kiro hooks and a `haunted-crew` agent profile in the project, signs you in if needed, starts the bridge,
prints the dashboard, workflows and pairing links, and warms spare agent sessions.

## Speed

- Spare sessions are prepared in the background, so summoning does not wait for `session/new`.
- The `haunted-crew` profile starts no MCP servers except `crew`, which keeps session start near one second.
- Screen frames decode off the render thread and only for screens someone is looking at.
