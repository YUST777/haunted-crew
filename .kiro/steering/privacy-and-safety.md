---
inclusion: always
---

# Privacy and safety rules

These rules protect the people who install Haunted Crew. Breaking one is a bug even if every test passes.

## Hook commands

- A hook command must always exit 0 unless it is meant to block. A non-zero exit from `PreToolUse` blocks the
  user's tool call, and Kiro Crew's `PreToolUse` fails closed.
- A hook must print nothing on stdout. Kiro injects stdout from `SessionStart` and `UserPromptSubmit` into the
  agent's context.
- A hook must never wait on the bridge. `send-event.mjs` gives up after 800 ms.

## What leaves the user's machine

- `normalize()` in `bridge/src/normalize.mjs` is the only code that reads hook payloads. Prompts, replies, tool input,
  tool output and file contents from hooks are dropped there. Keep it that way: add a field to the forwarded event
  only after deciding it is safe to show on a shared Minecraft server.
- Paths inside the project are shown relative to it; paths outside are reduced to the basename, so usernames and
  absolute paths never reach the screens.
- Console ghost chats are visible to everyone on the server. Say so wherever a user types into a ghost.
- Never log tokens. Never put a token in a URL query string; the browser links use `#token=` so it stays out of
  server logs.

## Tokens and roles

- Three tokens (ingest, command, view) live owner-only in `~/.haunted-crew/`, compared in constant time.
- Anything that starts a ghost, approves a tool, merges code or shows credits needs the command token.
- Pairing codes (`HC-XXXX-XXXX`) work once, for 10 minutes.

## Agents and git

- Agents get the git sandbox from `agentEnv()`: no network protocols, push URLs blocked, signing off, no prompts.
  Do not weaken it without `HAUNTED_CREW_ALLOW_GIT_NETWORK=1`.
- With `--worktrees`, agent code reaches the user's branch only after an in-game Merge. A merge must refuse a dirty
  checkout rather than half-merge.

## While working on this repo

- The `guard-shell` hook blocks force pushes, `git reset --hard`, `git clean -f`, `git checkout .` and `rm -rf` of the
  checkout. Do not work around it; ask the user.
- Never commit `~/.haunted-crew/`, `.env*`, Kiro or Cloudflare credentials, or anything under `node_modules/`.
- Deploying the website or making the GitHub repo public is the user's call. Ask first.
