# Requirements: Hook event bridge

## Introduction

People run Kiro agents in the IDE or CLI and cannot see what the agents are doing. Haunted Crew installs Kiro hooks that
forward metadata about each agent step to a local bridge, which turns it into ghost status shown in Minecraft and on a
dashboard. Because the events come from a user's private work and are shown on a shared Minecraft server, the bridge
must forward only metadata and must never slow down or block the agent.

Reference: `docs/kiro-integration.md`, `bridge/src/normalize.mjs`, `bridge/bin/send-event.mjs`.

## Requirements

### Requirement 1: Install the hooks into a project

**User story:** As a developer, I want one command to wire my Kiro project to Haunted Crew, so that my agents appear as
ghosts without editing hook files by hand.

#### Acceptance criteria

1. WHEN the launcher starts without `--no-hooks` THEN the system SHALL write `.kiro/hooks/haunted-crew.json` in the
   project folder with one command hook for each of these triggers: `SessionStart`, `UserPromptSubmit`, `Stop`,
   `PreToolUse`, `PostToolUse`, `PostFileCreate`, `PostFileSave`, `PostFileDelete`, `PreTaskExec`, `PostTaskExec`.
2. WHEN the hook file already has the same content THEN the system SHALL leave it unchanged and report "already installed".
3. WHEN the launcher starts with `--no-hooks` THEN the system SHALL not write a hook file.
4. WHEN `haunted-crew-install-hooks --global` is run THEN the system SHALL write the same file to `~/.kiro/hooks/`.

### Requirement 2: Never disturb the agent

**User story:** As a developer, I want the hooks to be invisible to my agent, so that watching it never changes what it does.

#### Acceptance criteria

1. WHEN a hook runs THEN the hook command SHALL exit with code 0 in every case, including when the bridge is not running.
2. WHEN a hook runs THEN the hook command SHALL print nothing on stdout, because Kiro adds stdout from `SessionStart`
   and `UserPromptSubmit` to the agent's context.
3. WHEN the bridge does not answer within 800 ms THEN the hook command SHALL give up and exit.
4. The hook entries SHALL set `timeout: 5`.

### Requirement 3: Forward metadata only

**User story:** As a developer on a shared Minecraft server, I want prompts and file contents to stay private, so that
friends watching the crew see activity but not my work.

#### Acceptance criteria

1. WHEN a hook payload arrives at `POST /event` THEN the bridge SHALL keep only: `id`, `ts`, `kind`, `session`, `agent`,
   and per kind the `tool`, `category`, `file`, `ok` and `task` fields defined in `docs/kiro-integration.md`.
2. The bridge SHALL drop prompt text, replies, tool input, tool output and file contents.
3. WHEN a file path is inside the project THEN the bridge SHALL show it relative to the project.
4. WHEN a file path is outside the project THEN the bridge SHALL reduce it to its basename.
5. WHEN a string contains control characters THEN the bridge SHALL replace them, and SHALL cap every string at its limit.
6. WHEN the trigger name is unknown THEN the bridge SHALL answer HTTP 400 `unknown trigger` and store nothing.

### Requirement 4: Map events to ghost status

**User story:** As a developer, I want a ghost's colour to tell me what its agent needs, so that I can read the crew from across the room.

#### Acceptance criteria

1. WHEN a prompt, tool, file or task event arrives THEN the session status SHALL become `working`.
2. WHEN a `stop` event arrives THEN the status SHALL become `waiting`.
3. WHEN a `tool_end` event has `ok: false` THEN the status SHALL become `error`.
4. WHEN a `session_start` event arrives THEN the status SHALL become `idle`.
5. WHEN a `session_end` event arrives THEN the session SHALL be removed.
6. WHEN more than 80 sessions exist THEN the bridge SHALL evict the one with the oldest `lastTs`.

### Requirement 5: Authenticate and rate-limit

**User story:** As a developer, I want only my own hooks to feed my bridge, so that nobody on the network can fake ghosts.

#### Acceptance criteria

1. WHEN a request to `POST /event` has no valid ingest token THEN the bridge SHALL answer HTTP 401.
2. WHEN the request uses the view or command token THEN the bridge SHALL answer HTTP 403.
3. WHEN one address has 20 failed authentications in a minute THEN the bridge SHALL answer HTTP 429 to that address.
4. The bridge SHALL bind to `127.0.0.1` unless the user passes `--host`.
