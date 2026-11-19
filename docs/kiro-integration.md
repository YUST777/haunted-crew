# Kiro integration

This document explains exactly how Haunted Crew uses Kiro: which Kiro commands and protocols the code calls, which files it writes into a project, which Kiro hook events it listens to, and which Kiro features the project relies on. Every statement here was checked against the source in this repository. Where something depends on Kiro's own behaviour and cannot be confirmed from this repository, it is marked as such in [Verification status](#verification-status).

## Table of contents

1. [Summary](#summary)
2. [Architecture](#architecture)
3. [Console ghosts: kiro-cli ACP sessions](#console-ghosts-kiro-cli-acp-sessions)
4. [The generated agent profile](#the-generated-agent-profile)
5. [The hook file and the Kiro hook events](#the-hook-file-and-the-kiro-hook-events)
6. [Kiro IDE hook agents (watch-only ghosts)](#kiro-ide-hook-agents-watch-only-ghosts)
7. [Account, sign-in and credits](#account-sign-in-and-credits)
8. [Model selection and credit multipliers](#model-selection-and-credit-multipliers)
9. [Spec tasks on the wall](#spec-tasks-on-the-wall)
10. [Steering and skills](#steering-and-skills)
11. [Plugin, setup skill and install prompt](#plugin-setup-skill-and-install-prompt)
12. [MCP: the crew server](#mcp-the-crew-server)
13. [What Kiro features this project uses](#what-kiro-features-this-project-uses)
14. [Verification status](#verification-status)

## Summary

Haunted Crew is a bridge (Node.js, in `bridge/`) and a Minecraft mod (Java, in `mod/`). Kiro is used in four ways:

| Use | What runs | Where in the code |
|---|---|---|
| Ghosts that take prompts from the console | `kiro-cli acp` (Agent Client Protocol over stdio), one process per pool slot, one session per ghost | `bridge/src/acp.mjs`, `bridge/src/agents.mjs` |
| Watching Kiro IDE and CLI work | Kiro hooks in `.kiro/hooks/haunted-crew.json` post event metadata to the bridge | `bin/haunted-crew.mjs`, `bin/install-hooks.mjs`, `bin/send-event.mjs`, `src/normalize.mjs` |
| Account, sign-in and credits | `kiro-cli whoami`, `kiro-cli login --use-device-flow`, `kiro-cli chat --no-interactive /usage` | `bridge/src/kiro.mjs` |
| Installing the project into Kiro | A generated agent profile `.kiro/agents/haunted-crew.json`, a plugin manifest, a setup skill and an install prompt | `bin/haunted-crew.mjs`, `plugin.json`, `skills/haunted-crew-setup/SKILL.md`, `INSTALL_PROMPT.md` |

The repository's own `.kiro/` folder (specs, steering and hooks used to build this project, see [.kiro/README.md](../.kiro/README.md)) is separate from the files the launcher writes into a user's project folder when it starts (see [The generated agent profile](#the-generated-agent-profile) and [The hook file](#the-hook-file-and-the-kiro-hook-events)).

## Architecture

```text
 Kiro IDE / kiro-cli (hooks)                  kiro-cli acp (console ghosts)
   .kiro/hooks/haunted-crew.json                 ^  stdio, JSON-RPC (ACP)
   runs: node send-event.mjs <Trigger>           |  initialize, session/new, session/prompt,
   |  POST /event (ingest token)                 |  session/cancel, session/set_model,
   v                                             |  session/request_permission, session/update
 +--------------------- bridge (Node, 127.0.0.1:8787) ----------------------+
 |  normalize.mjs  -> state.mjs (ghost status), history.jsonl               |
 |  agents.mjs     -> console ghosts, approval cards, model switch          |
 |  workflows.mjs  -> team runs, lead delegation, merges (worktrees)        |
 |  kiro.mjs       -> whoami / login / usage (kiro-cli subprocesses)        |
 +--------------------------------------------------------------------------+
   ^                                  |                         |
   | HTTP /tools/call (session token) | WebSocket /stream       | HTTP /kiro/*, /api/*
   |                                  v                         v
 crew-mcp.mjs (stdio MCP server,   Fabric mod (Minecraft)    dashboard, /workflows
 started by kiro-cli per session)  console, office, merges   editor, merge review
```

The Minecraft mod never runs `kiro-cli` itself. It sends HTTP requests to the bridge (for example `/kiro/status`, `/kiro/login`, `/agents`, `/api/workflows`) and receives state over the WebSocket. Sign-in happens between Kiro and the user's browser; the bridge only relays the URL and code that `kiro-cli login` prints.

## Console ghosts: kiro-cli ACP sessions

A console ghost is a Kiro agent started from the Minecraft console (or from a workflow box). It is a `kiro-cli acp` session that the bridge drives.

### Process and command line

Command resolution:

- Launcher (`bin/haunted-crew.mjs`): command is `HAUNTED_CREW_KIRO_CLI` if set, otherwise `kiro-cli`.
- Bridge alone (`bin/bridge.mjs` with `src/config.mjs`): agents are enabled only when `HAUNTED_CREW_WORKSPACE` is set; the command is `HAUNTED_CREW_KIRO_CLI` or `kiro-cli`, args `['acp']`, plus `--trust-all-tools` when `HAUNTED_CREW_TRUST_ALL_TOOLS=1`.

Arguments used by the launcher (not demo mode):

```text
kiro-cli acp --agent haunted-crew [--trust-all-tools] --model <model>
```

- `--agent haunted-crew` selects the generated profile described below.
- `--trust-all-tools` is added only when the launcher is started with `--trust-all-tools`.
- `--model <model>` is appended by `src/agents.mjs` unless the args already contain `--model`. The model is the default model (see [Model selection](#model-selection-and-credit-multipliers)).

Demo mode (`--demo`) replaces the command with `bin/demo-agent.mjs`, which speaks ACP and pretends to work. No Kiro account is used.

Pool: `src/agents.mjs` starts up to `HAUNTED_CREW_AGENT_PROCS` `kiro-cli` processes (default 4). Each process starts lazily and keeps one spare session ready so that summoning a ghost is nearly instant. A ghost is assigned to the process with the fewest sessions. The crew holds at most 70 ghosts (`MAX_AGENTS`).

Environment: each `kiro-cli` process gets the git sandbox environment from `agentEnv()` (see [Git sandbox](#git-sandbox)).

### ACP messages the bridge sends

The bridge implements a minimal Agent Client Protocol client (`src/acp.mjs`): JSON-RPC 2.0, one JSON object per line over the process's stdin/stdout. Stderr lines are logged and kept for error messages.

| Step | Method | Parameters the bridge sends | Notes |
|---|---|---|---|
| Handshake | `initialize` | `protocolVersion: 1`, `clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }` | Timeout 30 s. The bridge offers no file-system or terminal capability. |
| New ghost | `session/new` | `cwd` (project folder, or a worktree folder for reviewed-merge runs), `mcpServers` (the crew server, see [MCP](#mcp-the-crew-server)) | Timeout 120 s because kiro-cli starts the user's MCP servers before answering. The response gives `sessionId` and `models.availableModels` / `models.currentModelId`. |
| Model change | `session/set_model` | `sessionId`, `modelId` | Used when a ghost's model differs from the default, and for the in-console model switch (only while the ghost is idle). |
| One turn | `session/prompt` | `sessionId`, `prompt: [{ type: "text", text }]` | The reply and tool activity arrive as `session/update` notifications; the request resolves with `stopReason`. |
| Stop a turn | `session/cancel` (notification) | `sessionId` | Sent by the Stop button. Queued prompts are dropped. |
| Refused request | any other request from the agent | none | Answered with JSON-RPC error `-32601` (`unsupported: <method>`). |

### Messages the bridge receives

- `session/update` (or `session/notification`) with `update.sessionUpdate` of `tool_call`, `tool_call_update` (status `completed` or `failed`), `agent_message_chunk` and `agent_thought_chunk`. The bridge turns these into console events: `tool_start`, `tool_end`, `message`, `draft`, `thought`.
- `session/request_permission`: the bridge shows an approval card (see [Approvals](workflows.md#approvals)) with up to four of the agent's options. The answer is sent back as `{ outcome: { outcome: "selected", optionId } }`, or `{ outcome: { outcome: "cancelled" } }` on deny or timeout.

Tool kinds reported by Kiro are mapped to categories used for the ghost animations (`KIND_TO_CATEGORY` in `src/agents.mjs`):

| Kiro tool `kind` | Category |
|---|---|
| `read`, `search` | `read` |
| `edit`, `delete`, `move` | `write` |
| `execute` | `shell` |
| `fetch` | `web` |
| `think`, `other`, anything else | `other` |

### Git sandbox

`agentEnv()` in `src/agents.mjs` runs every `kiro-cli` process with these settings, unless `HAUNTED_CREW_ALLOW_GIT_NETWORK=1`:

- `GIT_ALLOW_PROTOCOL=haunted-crew-none` and `protocol.allow=never`: network git protocols are off.
- `url.haunted-crew-push-blocked:///.pushInsteadOf` set to an empty string: push URLs are rewritten to a dead one.
- `commit.gpgsign=false`, `tag.gpgsign=false`, and the gpg program settings pointed at a non-existent program: signing is off.
- `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`: git never prompts for credentials.

Local git (status, diff, add, commit, branch) still works.

### Timeouts and limits

| Item | Value | Source |
|---|---|---|
| `initialize` timeout | 30 s | `initTimeoutMs` |
| `session/new` timeout | 120 s | `sessionTimeoutMs` |
| Approval card auto-deny | 10 min, then "timed out" | `permissionTimeoutMs` |
| Prompt text per turn | 4000 chars from the console; 16 000 chars inside workflows | `src/agents.mjs`, `src/workflows.mjs` |
| Queued prompts per ghost | 10 | `src/agents.mjs` |
| Reply text kept per message | 1500 chars; thinking 1200 chars | `MAX_REPLY`, `MAX_THOUGHT` |

If a `kiro-cli` process exits, its ghosts end (`session_end`) and their pending approvals are dropped. A new process is started on the next summon.

## The generated agent profile

The launcher writes `<project>/.kiro/agents/haunted-crew.json` before it starts the bridge, unless `--demo` is used. The file is rewritten only when its content differs. The launcher's exact content:

| Field | Value written | Meaning |
|---|---|---|
| `name` | `"haunted-crew"` | Agent name passed to `kiro-cli acp --agent`. |
| `description` | `"A Haunted Crew ghost: a Kiro coding agent started from Minecraft (written by haunted-crew)"` | Shown in Kiro's agent list. |
| `model` | The default model, or the `--model` value (`claude-haiku-5.5` by default) | Model the profile starts with. |
| `tools` | `["*"]` | All built-in tools are available to the agent. |
| `allowedTools` | `["read", "glob", "grep"]` | Read-only tools listed here. The launcher does not set anything else; for other tools, approval requests from Kiro reach the console as approval cards (unless `--trust-all-tools` is used). Kiro's own handling of this field is not verified here. |
| `resources` | `["file://README.md", "file://AGENTS.md", "file://.kiro/steering/**/*.md"]` | Context files loaded into the agent. `AGENTS.md` does not exist in this repository. |
| `includeMcpJson` | `true` with `--mcp`, otherwise `false` | Whether the user's own MCP configuration is included. What Kiro does with this field is Kiro's behaviour; not verified here. |
| `mcpServers` | `{}` | No extra MCP servers are declared by the profile. The crew server is passed per session (see [MCP](#mcp-the-crew-server)). |

Why MCP is off by default: the launcher comment says that Kiro starts every MCP server once per session, which made each summon take seconds, so ghosts start without the user's MCP servers unless `--mcp` is given. The crew server (see [MCP](#mcp-the-crew-server)) is not affected by this setting.

## The hook file and the Kiro hook events

### Where it is written

`bin/haunted-crew.mjs` writes `<project>/.kiro/hooks/haunted-crew.json` at start, unless `--no-hooks` is given. `bin/install-hooks.mjs` writes the same file on its own: `node bin/install-hooks.mjs <project>` for a project, or `--global` for `~/.kiro/hooks/haunted-crew.json`.

### File structure

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "haunted-crew-<Trigger>",
      "description": "Forward event metadata to the Haunted Crew bridge (always exits 0, prints nothing).",
      "trigger": "<Trigger>",
      "action": { "type": "command", "command": "node \"<abs path>/send-event.mjs\" <Trigger>" },
      "timeout": 5
    }
  ]
}
```

One entry per trigger. The `command` runs `send-event.mjs` with the trigger name as its argument. The absolute path is the location of `send-event.mjs` in the installed `haunted-crew` package at the time the file was written.

### What send-event does

`bin/send-event.mjs` (also installed as the `haunted-crew-send` command):

1. Reads the hook event JSON from stdin, up to 1 MiB.
2. POSTs it to `HAUNTED_CREW_URL` (default `http://127.0.0.1:8787`) at `/event`, with `authorization: Bearer <ingest token>` and the header `x-kiro-trigger: <Trigger>`. The ingest token comes from `HAUNTED_CREW_INGEST_TOKEN` or `~/.haunted-crew/tokens.json`.
3. Waits at most 800 ms (`HAUNTED_CREW_TIMEOUT_MS`), then exits with code 0 in every case. Errors are printed only when `HAUNTED_CREW_DEBUG` is set.

Prints nothing on stdout, because Kiro injects stdout from `SessionStart` and `UserPromptSubmit` into the agent's context. Exit code 0 always, because a non-zero exit from `PreToolUse` would block the tool.

### Triggers used

The launcher and `install-hooks.mjs` install exactly these ten triggers (`TRIGGERS` in `bin/install-hooks.mjs`):

`SessionStart`, `UserPromptSubmit`, `Stop`, `PreToolUse`, `PostToolUse`, `PostFileCreate`, `PostFileSave`, `PostFileDelete`, `PreTaskExec`, `PostTaskExec`

### What is forwarded and what is dropped

The bridge's `normalize()` (`src/normalize.mjs`) is the only place where hook payloads are read. It builds a small event and discards the rest. The request body and headers are never stored.

Kept for every event: `id` (new random id), `ts`, `kind`, `session` (`session_id`, `sessionId` or `conversation_id`, default `default`), and `agent` (`agent_name`, `agentName` or `agent`, max 40 chars).

| Kiro trigger (hook) | Event kind | Forwarded (in addition to the common fields) | Dropped |
|---|---|---|---|
| `SessionStart` | `session_start` | nothing else | everything else in the payload |
| `UserPromptSubmit` | `prompt` | nothing else | the prompt text (never read) |
| `Stop` | `stop` | nothing else | the reply text and any stop details |
| `PreToolUse` | `tool_start` | `tool` (tool name, max 64 chars), `category`, `file` (path relative to the project, see below) | `tool_input` and all arguments |
| `PostToolUse` | `tool_end` | `tool`, `category`, `file`, and `ok` (from `tool_response`: `success`, `error`/`is_error`/`isError`, or `exit_code`/`exitCode`) | `tool_response` body, command output, and large tool output |
| `PostFileCreate` | `file_create` | `file` | file contents |
| `PostFileSave` | `file_save` | `file` | file contents |
| `PostFileDelete` | `file_delete` | `file` | file contents |
| `PreTaskExec` | `task_start` | `task` (title from `task.title`, `task.name`, `task_title`, `task_name`, `taskId` or `task_id`, max 120 chars) | the rest of the task object |
| `PostTaskExec` | `task_end` | `task` (same rule) | the rest of the task object |

Rules applied to forwarded values:

- `category` is taken from `tool_tags` when present (first of `write`, `shell`, `web`, `subagent`, `spec`, `read`, or `@mcp`). Otherwise it is taken from the tool name: names matching `mcp_` give `mcp`, `subagent` gives `subagent`, `spec` gives `spec`, `web_` or `web_search` or `web_fetch` give `web`, `execute_bash`, `execute_pwsh`, `execute_cmd` or `shell` give `shell`, names with `write`, `str_replace`, `append`, `delete_file`, `create_file` or `edit` give `write`, names with `read`, `grep`, `glob`, `list`, `search`, `introspect` or `code` give `read`, and anything else is `other`.
- `file` is taken from `file_path`, `filePath`, `path`, `tool_input.path`, `tool_input.file_path` or `tool_input.filePath`. A path inside the project is shown relative to it. A path outside the project is reduced to its basename, so absolute paths and usernames never reach the screens.
- Control characters are removed from every string, and each string is capped.
- Events of kind `prompt` and `stop` never carry `file`.
- Unknown trigger names are rejected with HTTP 400 (`unknown trigger`).

Accepted aliases in `normalize()` (kept for older or Crew spellings): `AgentSpawn`, `agentSpawn` (as `session_start`), `SessionEnd` (as `session_end`), `userPromptSubmit`, `promptSubmit`, `agentStop`, `stop`, `preToolUse`, `postToolUse`, `fileCreated`, `FileCreated`, `fileEdited`, `FileEdited`, `fileDeleted`, `FileDeleted`, `PreTaskExecution`, `preTaskExecution`, `PostTaskExecution`, `postTaskExecution`.

### Where the forwarded events go

Each accepted event is:

1. Applied to the ghost state (`src/state.mjs`): the ghost's status is decided there. `working` for prompt, tool, file and task events; `waiting` for `stop` and `permission`; `error` for `error` and for a `tool_end` with `ok: false`; `idle` for `session_start`; `session_end` removes the ghost.
2. Appended to the searchable history `.haunted-crew/history.jsonl` (`src/history.mjs`, up to 5000 events), which the crew tools `history_search` and `history_read` read.
3. Broadcast over the WebSocket to the Minecraft mod and the dashboard.

## Kiro IDE hook agents (watch-only ghosts)

Every session that reports hook events (Kiro IDE or CLI, not started from the console) appears as a ghost identified by its `session_id`. These ghosts:

- are watch-only: `POST /agents/<id>/prompt` returns HTTP 404 with `not a console agent (hook-reported agents are watch-only)`;
- have no crew tool token and no approval cards;
- animate from the event kinds in the table above (tool use, file edits, task start and end, stop).

Console ghosts have the same visuals plus chat, approvals and the prompt queue.

## Account, sign-in and credits

All Kiro account calls live in `bridge/src/kiro.mjs` and run the official CLI as a subprocess. The bridge never reads or stores Kiro credentials.

| Bridge endpoint | Token | Kiro command | Result used by the game |
|---|---|---|---|
| `GET /kiro/status` | view | `kiro-cli whoami` (timeout 10 s, cached 15 s) | `signedIn`, `installed` and `user` (the first line of output, max 80 chars). The text "not logged in" means signed out. A missing binary means `installed: false`. |
| `POST /kiro/login` | command | `kiro-cli login --license free --use-device-flow` | The bridge reads the printed `https://` URL and the `XXXX-XXXX` device code from the output and shows them in the console. The sign-in page is Kiro's own. The process is stopped after 15 minutes. |
| `GET /kiro/usage` | command | `kiro-cli chat --no-interactive /usage` (timeout 30 s, cached 60 s) | Parses `Credits (<used> of <total> ...), <percent>%` and the `Estimated Usage | resets on <date> | <plan>` line. Returns `used`, `total`, `percent`, `plan`, `resets`. |

In demo mode the same endpoints return fixed values (`signedIn: true`, `user: "demo mode"`, usage `123.4` of `1000`, plan `DEMO`).

The console shows the sign-in state and the usage in the context panel. The button "Sign in to Kiro" calls `kiro_login`. The usage is requested only when the panel is opened.

The launcher checks `kiro-cli whoami` at start and prints one of: `demo mode`, `kiro-cli not found`, `not signed in yet`, or `signed in`. Ghosts are warmed up only when signed in or in demo mode.

## Model selection and credit multipliers

### Default model

- `DEFAULT_MODEL` in `src/agents.mjs` is `claude-haiku-5.5`.
- The launcher's `--model <id>` option or the `HAUNTED_CREW_MODEL` environment variable replaces it. The same value is written into the agent profile and passed to `kiro-cli acp --model`.

### Per-ghost model

- A new ghost can name a model. The bridge checks the id against the list Kiro returned (`models.availableModels` from the first `session/new`, up to 40 entries) and returns HTTP 400 `Kiro has no model "<id>"` when it is not on the list.
- If the chosen model differs from the session's current model, the bridge sends `session/set_model`.
- The console's model button calls `POST /agents/<id>/model` (`session/set_model`). It is refused with HTTP 409 `wait until the ghost is idle` while the ghost has a running turn or queued prompts.
- `GET /agents` returns the model list in `models`.

### Models and credit multipliers as labelled in the code

These labels appear in the in-game workflow editor (`WorkflowScreen.java`, `MODELS`) and the browser editor (`bridge/src/workflows.html`, `MODELS`):

| Model id | Label in the code | Multiplier shown |
|---|---|---|
| (empty) | Crew default | none |
| `claude-haiku-5.5` | Haiku 5.5, fast | 0.06x |
| `qwen3-coder-next` | Qwen3 Coder | 0.05x |
| `claude-sonnet-5.5` | Sonnet 5.5 | 1.3x |
| `claude-opus-5.5` | Opus 5.5 | 2x |
| `auto` | Auto | 1x |

The browser editor replaces this list with the live model list from Kiro once the bridge knows it (`GET /agents`). The in-game editor keeps the fixed list. The multipliers are the labels written in the code; they are not read from Kiro at runtime.

## Spec tasks on the wall

Kiro's task events drive the task wall in the Haunted Office:

- `PreTaskExec` becomes `task_start`, and `PostTaskExec` becomes `task_end`. The task title is forwarded from the payload (see the table above).
- `src/state.mjs` sets the ghost's `task` on `task_start` and clears it on the matching `task_end`.
- The big-screen dashboard lists the tasks: a started task is shown unchecked and an ended task is shown checked (`ScreenWall.java`: `task_start` puts the task as not done, `task_end` as done).

The task wall works from the hook events only and does not read spec files. The repository has its own specs in `.kiro/specs/` (`hook-event-bridge`, `reviewed-merges`, `steve-chase-section`); the bridge never reads them.

## Steering and skills

### Steering

- This repository's `.kiro/steering/` holds nine steering files for building Haunted Crew itself (product, tech, structure, privacy and safety, writing style, and one each for bridge, mod, site and Blender assets). They are for developers using Kiro on this repo, not part of what the launcher installs.
- The generated profile lists `file://.kiro/steering/**/*.md` as a resource, so a project with steering files gives its ghosts those files as context.
- A user's project gets steering only if the user writes it; the launcher does not create steering files.

### Skills: where SKILL.md files are found

`skills()` in `src/workflows.mjs` looks in these folders of the project, in this order:

1. `.kiro/skills/<name>/SKILL.md`
2. `skills/<name>/SKILL.md`
3. `.claude/skills/<name>/SKILL.md`

Limits: at most 30 skills, each file at most 64 KB, and the instructions shown are capped at 12 000 characters. The frontmatter fields `name` and `description` are read; the body is the instructions. The list is served by `GET /api/skills` (view token) and shown in the custom agent editor as "Load SKILL.md from project".

Custom agents can use a `SKILL.md` as their instructions (see [workflows.md](workflows.md#custom-agents-prompt-or-skillmd)).

### Skill store: writing SKILL.md files

`src/skillstore.mjs` creates, revises, lists, removes and installs skills under `<project>/.kiro/skills/<slug>/SKILL.md`:

- `POST /api/skills` (create: `name`, `description`, `instructions`), `PUT /api/skills/<slug>` (revise), `DELETE /api/skills/<slug>` (remove), and `install` from a local `SKILL.md` path (64 KB max). All need the command token.
- Slugs are lowercase letters, digits and hyphens, 1 to 40 characters. A slug may not escape the skills folder.
- The skill store is not connected to the crew tools (agents cannot create skills through MCP; the lead's text fallback `create_agent` saves a custom agent instead, see [workflows.md](workflows.md#lead-delegation-protocol)).

### Backup

`src/backup.mjs` exports `<project>/.haunted-crew/**` and `<project>/.kiro/skills/**/SKILL.md`. Token files (`tokens*.json`) are never exported. In JSON and JSONL files, string or object values under keys whose name contains `secret`, `token`, `password`, `api_key` or `api-key` are replaced with `null`. Database files (`.db`, `.sqlite`, `.sqlite3`) are exported as base64 entries without redaction.

### The skill shipped in this repository

`skills/haunted-crew-setup/SKILL.md` is the setup skill for Kiro (see below). Its frontmatter is `name: haunted-crew-setup`.

## Plugin, setup skill and install prompt

Three files let a Kiro agent install Haunted Crew for a project.

### plugin.json

Fields in `plugin.json` at the repository root:

| Field | Value |
|---|---|
| `$schema` | `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` |
| `name` | `haunted-crew` |
| `version` | `0.1.0` |
| `description` | "Install Haunted Crew: watch and command your Kiro agents as ghosts in a Minecraft haunted office. Sets up the mod, Fabric, the bridge and your project, step by step." |
| `author` | `{ "name": "Haunted Crew" }` |
| `keywords` | haunted crew, minecraft, ghosts, fabric mod, agent office, kiroween |
| `license` | `MIT` |

The manifest does not list its skill. The skill is found at `skills/haunted-crew-setup/SKILL.md`. How Kiro's Powers panel reads the manifest is Kiro's behaviour and is not verified here (see [Verification status](#verification-status)).

### Installing as a Kiro Power

The README's route: Kiro → Powers panel → Add Custom Power → Import power from GitHub → paste the repository URL, then ask Kiro "set up Haunted Crew".

### What the setup skill tells the agent to do

`skills/haunted-crew-setup/SKILL.md` gives five steps, run by the agent with its own terminal:

1. Check `node --version` (v20 or newer), `kiro-cli --version`, and optionally `java -version`. Ask the user to install Node.js or kiro-cli if they are missing.
2. Install the mod: `npx -y -p haunted-crew haunted-crew-minecraft` (Fabric Loader, Fabric API and the mod, for Minecraft 26.3). Handle "Minecraft folder not found" (use `--minecraft-dir`) and "Fabric installer failed". Fallback: build the mod from source and run `node bin/install-minecraft.mjs --jar ...`.
3. Check `kiro-cli whoami`; if not signed in, run `kiro-cli login` and wait for the user.
4. In the project folder, run `npx -y haunted-crew .` and keep it running. The output must show "Kiro hooks ✔", "signed in" and "running on 127.0.0.1:8787". Options: `--model`, `--mcp`, `--demo`, `--port 8788`.
5. Tell the user how to play: choose the Fabric 26.3 profile, create a Haunted Office world, right-click Boo for a tour, press K, use the workflows link.

It also lists troubleshooting for "Bridge not paired", "Sign in to Kiro first" and an empty Minecraft screen.

### What the install prompt tells the agent to do

`INSTALL_PROMPT.md` is a paste-in prompt with the same steps in shorter form: check Node 20+ and kiro-cli; run `npx -y -p haunted-crew haunted-crew-minecraft`; run `kiro-cli whoami` and `kiro-cli login` if needed; run `npx -y haunted-crew .` in the background; then tell the user what to click in Minecraft and give the workflows link.

## MCP: the crew server

Every console ghost gets a stdio MCP server named `crew`. It is passed in `session/new`:

```json
{
  "name": "crew",
  "command": "<node executable>",
  "args": ["<path>/bin/crew-mcp.mjs"],
  "env": [
    { "name": "HC_BRIDGE_URL", "value": "http://127.0.0.1:<port>" },
    { "name": "HC_TOKEN", "value": "<random UUID for this session>" }
  ]
}
```

- The token is random per session. The bridge maps it to the ghost's session, so every tool call is made as that ghost (its name and memory). Unknown tokens get HTTP 401.
- `crew-mcp.mjs` only forwards: `tools/list` calls `GET /tools`, and `tools/call` calls `POST /tools/call` on the bridge. It answers `initialize` with server name `crew`, protocol version from the client (default `2024-11-05`), and the `tools` capability.
- Set `HAUNTED_CREW_MCP=0` to start sessions with no MCP servers (`mcpServers: []`).
- The launcher's `--mcp` flag gives ghosts the user's own MCP servers too (through `includeMcpJson`; see the profile section).

### Crew tools

| Tool | Arguments | What it does |
|---|---|---|
| `send_message` | `to`, `text` | Sends a message to a working teammate and waits up to 5 minutes for the reply. Refuses a message to itself, and refuses a cycle where the target is waiting for the caller. |
| `list_agents` | none | Lists working agents with `busy`. |
| `ask_user` | `question`, `options` (array) | Shows the question as an approval card with the options; returns the chosen text, or "(no answer; decide yourself)" after 10 minutes. |
| `remember` | `text`, `tags` (array) | Saves a memory for the calling agent (by its name). |
| `search_memories` | `query` | Returns up to 5 matching memories. |
| `forget_memory` | `id` | Forgets one memory. |
| `list_tables` | none | Lists tables in the shared SQLite database and their owners. |
| `query_data` | `sql`, `params` | Runs one `SELECT` or `WITH` statement. |
| `execute_data` | `sql`, `params` | Runs one `INSERT`, `UPDATE`, `DELETE`, `CREATE TABLE`, `CREATE INDEX`, `DROP TABLE` or `ALTER TABLE`. Only the owner of a table can drop or rename it. |
| `delete_table` | `name` | Drops a table the caller created. |
| `history_search` | `query` | Searches past crew events, up to 5 hits. |
| `history_read` | `id` | Reads the events around one history hit. |

Replies to tools are capped at 8000 characters. Tool errors are returned to Kiro as MCP errors with `isError: true`.

### Mid-turn notes

Messages delivered to an agent that do not expect a reply are added to the agent's next tool result as `[NEW MESSAGES]` (`src/tools.mjs`, `pendingNotes`). See [workflows.md](workflows.md#mid-turn-steering).

### Text fallback

Workflow teammates are also told how to reach the same tools without MCP: they can end a reply with a JSON block such as `{"tool":"list_agents","args":{}}`. The prompt says to use the `crew` tools directly when they are available and to ignore the JSON form in that case. See [workflows.md](workflows.md#lead-delegation-protocol).

## What Kiro features this project uses

| Kiro feature | Used? | How | Evidence in the repository |
|---|---|---|---|
| kiro-cli ACP mode (`kiro-cli acp`) | Yes | Console ghosts and workflow boxes are ACP sessions. Protocol version 1; no fs or terminal capability. | `bridge/src/acp.mjs`, `bridge/src/agents.mjs`, `bin/haunted-crew.mjs` |
| ACP session model switching | Yes | `session/set_model` for a ghost's model. | `bridge/src/agents.mjs` |
| ACP permission requests | Yes | `session/request_permission` shown as approval cards; Allow or Reject. | `bridge/src/agents.mjs` |
| ACP session cancel | Yes | `session/cancel` for the Stop button. | `bridge/src/agents.mjs` |
| Custom agent profile (`.kiro/agents/<name>.json`) | Yes | `haunted-crew.json` written by the launcher and selected with `--agent`. | `bin/haunted-crew.mjs` |
| Agent `allowedTools` and `resources` | Yes | `read`, `glob`, `grep`; README, AGENTS.md, steering. | `bin/haunted-crew.mjs` |
| Hooks (`.kiro/hooks/*.json`, action `command`) | Yes | Ten triggers, `timeout: 5`, one command per trigger. | `bin/install-hooks.mjs`, `bin/haunted-crew.mjs` |
| Hook triggers `SessionStart`, `UserPromptSubmit`, `Stop`, `PreToolUse`, `PostToolUse` | Yes | Ghost status, animations and history. | `src/normalize.mjs` |
| Hook triggers `PostFileCreate`, `PostFileSave`, `PostFileDelete` | Yes | File animations, live code view. | `src/normalize.mjs` |
| Hook triggers `PreTaskExec`, `PostTaskExec` | Yes | Spec task wall. | `src/normalize.mjs`, `src/state.mjs`, `ScreenWall.java` |
| Kiro account commands (`whoami`, `login --use-device-flow`, `chat --no-interactive /usage`) | Yes | Sign-in, credits and plan in the console. | `bridge/src/kiro.mjs` |
| Models chosen in Kiro (`models.availableModels`) | Yes | Per-ghost and per-box model choice, validated against Kiro's list. | `bridge/src/agents.mjs`, `bridge/src/workflows.html` |
| MCP servers in `session/new` | Yes | The `crew` server with per-session token and 12 tools. | `bridge/bin/crew-mcp.mjs`, `bridge/src/tools.mjs` |
| `--trust-all-tools` | Optional | Passed to `kiro-cli acp` when the launcher flag is used. | `bin/haunted-crew.mjs` |
| `SKILL.md` skills (`.kiro/skills/`, `skills/`, `.claude/skills/`) | Yes | Discovered for custom agents; written by the skill store. | `bridge/src/workflows.mjs`, `bridge/src/skillstore.mjs` |
| Steering (`.kiro/steering/*.md`) | Yes | Listed as a profile resource for a user's project. This repository also has nine steering files of its own for building it. | `bin/haunted-crew.mjs`, `.kiro/steering/` |
| Spec files (`.kiro/specs/`) | Yes, for development | Three specs with requirements, design and tasks. The bridge does not read specs; spec task events arrive through the task hooks. | `.kiro/specs/`, `.kiro/README.md` |
| Plugin manifest and Kiro Power install | Yes | `plugin.json`, setup skill, install prompt. | `plugin.json`, `skills/haunted-crew-setup/SKILL.md`, `INSTALL_PROMPT.md` |
| Kiro IDE and CLI hooks (watch-only ghosts) | Yes | Events from Kiro sessions shown as ghosts that cannot be prompted. | `src/normalize.mjs`, `src/agents.mjs` |

## Verification status

Checked in this repository:

- Every command, flag, JSON field, hook trigger and endpoint named above appears in the source files cited.
- The generated profile and hook file are produced by the launcher and `install-hooks.mjs` exactly as described.
- The repository has a `.kiro/` folder at its root with `specs/`, `steering/` and `hooks/`, and it is not gitignored (`git check-ignore` reports nothing for it).

Not verified here, and marked as such:

- That Kiro emits the trigger names used in the hook file (`PreTaskExec`, `PostFileCreate` and the others) with these exact names and payload fields. The aliases in `normalize.mjs` were written to cover the spellings Kiro's documentation was read with on 2026-11-04 (see `PLAN.md`).
- That Kiro reads `plugin.json` as a Power manifest and loads `skills/haunted-crew-setup/SKILL.md` automatically.
- What Kiro does with the profile fields `includeMcpJson`, `resources` (including the missing `AGENTS.md`) and `allowedTools`.
- The exact output of `kiro-cli whoami`, `login` and `chat --no-interactive /usage`. The parsers in `kiro.mjs` follow the format documented in the code comments; a different output format would show as "could not read usage" or as signed out.
- Real `kiro-cli acp` sessions end to end. `PLAN.md` (status dated 2026-11-04) lists this as still to verify; the test suite uses a scripted agent (`bridge/test/fake-acp.mjs`) and the demo agent (`bridge/bin/demo-agent.mjs`).
- The context-window figure (1M for Claude models) in the README. The code has a `ceil(length / 4)` token estimate in `bridge/src/compaction.mjs`; the README says context is a lower bound.
