# Design: Hook event bridge

## Overview

```text
Kiro hook ──stdin JSON──► send-event.mjs ──POST /event (ingest token, 800 ms)──► bridge
                                                                                   │
                       normalize()  ──►  state.apply()  ──►  history.record()  ──►  WS /stream ──► Minecraft mod, dashboard
```

The bridge is one Node process (`bridge/src/server.mjs`). Hook events and console-agent (ACP) events share one event
shape, so the mod and the dashboard never care where an agent came from.

## Components

| Component | File | Responsibility |
|---|---|---|
| Hook installer | `bridge/bin/install-hooks.mjs` | Builds the hook file from `TRIGGERS`; writes it to the project or home folder. |
| Hook sender | `bridge/bin/send-event.mjs` | Reads stdin (max 1 MiB), POSTs to `/event`, always exits 0, prints nothing. |
| Normalizer | `bridge/src/normalize.mjs` | The only code that reads a hook payload. Maps trigger to event kind, derives `category`, cleans strings and paths. |
| State | `bridge/src/state.mjs` | One session per ghost: status, last tool, task. Keeps the last 500 non-draft events. |
| History | `bridge/src/history.mjs` | Appends events to `.haunted-crew/history.jsonl` (5000 kept) for `history_search`. |
| Auth | `bridge/src/auth.mjs` | Role from token (constant-time compare), failure limiter (20 per minute per address). |

## Data model

Event envelope: `id`, `ts`, `kind`, `session`, optional `agent`, `tool`, `category`, `ok`, `file`, `task`.

Trigger to kind: `SessionStart` to `session_start`, `UserPromptSubmit` to `prompt`, `Stop` to `stop`, `PreToolUse` to
`tool_start`, `PostToolUse` to `tool_end`, `PostFileCreate/Save/Delete` to `file_create/save/delete`,
`PreTaskExec` to `task_start`, `PostTaskExec` to `task_end`. Older spellings are accepted as aliases.

Status table: see requirement 4. A new session starts `idle`.

## Error handling

| Case | Behaviour |
|---|---|
| Bridge not running | `send-event.mjs` times out after 800 ms and exits 0. The agent is unaffected. |
| Body is not a JSON object | HTTP 400 `event body must be a JSON object`. |
| Unknown trigger | HTTP 400 `unknown trigger: <name>`. Nothing is stored. |
| Body over 1 MiB | HTTP 413. |
| Bad or missing token | 401, counted by the limiter. 403 for the wrong role, not counted. |

## Key decisions

- **One normalizer.** Privacy rules live in one place, so a new field must be added on purpose.
- **Exit 0 always.** A non-zero exit from `PreToolUse` blocks the user's tool call, and Kiro Crew's `PreToolUse` fails closed.
- **Silent stdout.** Kiro injects stdout from some triggers into the agent's context, so the sender never prints there.
- **Ingest token separate from the view token.** Watchers can read state but cannot post events.

## Testing strategy

Covered today:

- `bridge/test/normalize.test.mjs` (7 tests): tool events with stripped payloads, header trigger and legacy names, prompt
  text never forwarded, unknown triggers and non-objects, tool categories, paths outside the project, control characters and long strings.
- `bridge/test/server.test.mjs`: `/event` needs the ingest token (401 for a wrong token, 403 for the view token), bad
  input and the 1 MiB limit (413), stream auth, events broadcast with the derived ghost status, `send-event.mjs` exits 0
  and prints nothing even with the bridge down, dashboard served without the token in it.
- `bridge/test/pairing.test.mjs`: codes expire after 10 minutes, junk codes are rejected.

Not covered yet (open tasks 8 to 10 in `tasks.md`):

- The 429 answer from the failure limiter.
- Session state: eviction above 80 sessions, the 60-minute idle sweep, the status table (there is no `state.test.mjs`).
- Real Kiro payloads. `PLAN.md` lists capturing one real payload per trigger as open work.
