# Architecture

```
Kiro IDE / CLI ──hooks──┐
                        ├─► bridge (Node 22) ──WebSocket──► Fabric mod (server) ──► ghosts, office, console
console agents ◄──ACP───┘     │  ▲                              │
  (kiro-cli acp, git            │  └──── HTTP (command token) ◄───┘  prompts, approvals, merges, sign-in
   worktree per run)            └──► headless Chrome ──JPEG frames──► big screens
```

## The three parts

**Bridge (`bridge/`)** is a dependency-light Node 22 ESM service. It has two jobs:

1. *Observe.* Kiro hook events (from the IDE or CLI) are posted to `/event`, stripped of prompts and file contents,
   normalised to one event shape and broadcast on `WS /stream`.
2. *Act.* It starts agents of its own through the Agent Client Protocol (`kiro-cli acp`), runs workflows over them,
   keeps their memory, shared database, routines and history, and gates their work behind approvals and merges.

**Mod (`mod/`)** is a Fabric mod for Minecraft 26.3 (Java 25, split client/main source sets). The server side holds the
crew state, the Haunted Office, the screen wall and the HTTP/WebSocket client to the bridge. The client side renders
ghosts and implements the console, workflow editor, merge review and browser screens.

**Tools (`tools/`)** is the Blender pipeline that produced the ghost and monitor models and the office.

## Event flow

1. A Kiro agent calls a tool. Its hook runs `send-event.mjs`, which always exits 0 and prints nothing.
2. The bridge drops sensitive fields, assigns a ghost identity per session, and emits `tool_start` / `tool_end`.
3. The mod's `BridgeClient` receives the event and updates the ghost: glow colour for status, an item in hand for the
   tool category, a walk to the matching desk.
4. Commands go the other way over HTTP with the command token: summon, prompt, answer approval, merge.

## Console agents

Console agents are started by the bridge itself. `src/acp.mjs` speaks ACP over stdio, `src/agents.mjs` pools processes
and keeps a spare session ready so a summon is near instant, and `src/normalize.mjs` turns ACP updates into the same
event shape hooks produce. That is why hook agents and console agents look identical in the world.

## Design choices

- **One event shape** for everything, so the mod and the dashboard never care where an agent came from.
- **No secrets in the stream.** Prompts, file contents and tool output from hooks never leave the bridge.
- **The checkout is sacred.** Agents work in worktrees and land code only after an in-game approval.
- **Everything optional.** No Chrome means no browser screen; no git repo means no worktrees; the rest keeps working.
