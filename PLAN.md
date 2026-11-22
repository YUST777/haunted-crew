# Kiroween 2026 — Haunted Crew (working name)

**Category:** Frankenstein (Minecraft + Kiro agents + live web dashboard + multiplayer)
**Deadline:** Fri Dec 4, 2026, 2:00 PM PT
**Pitch:** Agents are black boxes and terminal walls. Haunted Crew turns your Kiro agents into ghosts working in a haunted Minecraft office, with a giant live screen and friends who can join and watch.

## Status (2026-11-04, early planning snapshot; the current status is in README.md)

Done and tested (bridge: 22 tests, mod: 12 tests, plus live runs in the game):
- `haunted-crew` launcher: Kiro hooks install, Kiro sign-in check, bridge, zero-config discovery on the same PC, pairing codes, `--demo`.
- Bridge: hook events, console agents over ACP (`kiro-cli acp`), approvals, Kiro status / device-flow sign-in, three token roles.
- Mod: Haunted Office world type, desks with 3D monitors, Blender-made ghosts with job hats, AI-chat console (K), `/crew pair`.

Still to verify / do:
- Real `kiro-cli acp` agents and the real device-flow sign-in (only the demo agent and signed-out CLI were tested).
- Publish the npm package (`cd bridge && npm publish`) so `npx haunted-crew` works; the name is free.
- Kiro specs / steering made in Kiro, demo video, Kiro write-up, GitHub repo with license.

## 1. Characters: Kiro ghosts

Each agent is a small floating ghost. Its job shows as a hat or held tool. Original model, made by us (not Kiro's official logo art unless brand rules allow).

| Job | Hat / tool | Idle animation | Working animation |
|---|---|---|---|
| Planner (spec writer) | Wizard hat + scroll | Reads scroll | Pins task cards to wall |
| Coder | Hard hat + pickaxe | Spins pickaxe | Mines / places blocks at desk |
| Tester | Lab goggles + potion | Shakes potion | Throws potion: green = pass, red = fail |
| Reviewer | Detective hat + magnifier | Looks around | Inspects code, stamps approve |
| Docs writer | Quill behind ear + book | Flips pages | Writes in book |
| Researcher (MCP / web) | Explorer hat + compass | Checks compass | Flies out a window and back |

Ghost state, readable from far away:
- Glow color: blue = working, yellow = waiting for you, red = error, grey = idle.
- Name tag: agent name + current task.
- Speech bubble: short status ("running tests...").

## 2. World: haunted office at night

- Desks in a ring, one per ghost, each with a small monitor.
- **Big wall screen** (main feature): live web dashboard of the whole crew.
- Task wall: spec tasks as item frames / signs, tick off live.
- Steering lectern: book with the project's steering rules.
- Hook bell / redstone: rings when a Kiro hook fires.
- Pumpkins, cobwebs, fog, candles. Lightning on a failed build, fireworks on all tests green.

## 3. Event to animation map

| Kiro event | In world |
|---|---|
| Prompt submitted | Bell rings, planner ghost wakes up |
| Spec task started | Task card lights up, ghost flies to its desk |
| File read | Ghost opens book at desk |
| File write / edit | Ghost places blocks, monitor shows diff |
| Shell command | Ghost mines |
| Tests pass / fail | Potion green / red, fireworks / lightning |
| Hook fired | Redstone pulse + bell |
| Waiting for user | Ghost floats to player, yellow glow, "!" |
| Agent stop | Ghost returns to desk, grey |

## 4. Architecture

```
Kiro (IDE / CLI / Crew)
   │  hooks run: curl POST event JSON
   ▼
Bridge (Node.js, runs next to Minecraft server)
   ├─ WebSocket ──► Dashboard (web app, served by bridge at http://<server-ip>:8787)
   └─ WebSocket ──► Fabric mod (server side) ──► ghost entities, task wall, effects
                                                  │
                         Minecraft clients (you + friends) see same world
                         Big wall screen = in-game Chromium (WebScreen-style, MIT) showing the dashboard
```

- **Bridge:** Node + `ws`. Normalizes events, keeps state, replays history to late joiners.
- **Dashboard:** plain web app (works alone in any browser — this is what judges can test fast).
- **Mod:** Fabric, Java. Ghost entity + hats as model layers, desk/screen blocks, effects.
- **Multiplayer:** dashboard URL must be the server IP, not `localhost` (each player's browser is local).
- **Sim mode:** bridge replays a recorded Kiro session. Lets judges and the demo run without Kiro or API keys.
- API keys never enter Minecraft. They stay in Kiro on the user's machine.

## 5. Step 0 — verify before building (Day 1)

- [x] Which hook triggers Kiro exposes — checked kiro.dev/docs/hooks (2026-11-04):
  - IDE + CLI V3: `PromptSubmit`, `AgentStop`, `SessionStart`, `PreToolUse`, `PostToolUse`, `FileCreate`, `FileSave`, `FileDelete`, `PreTaskExecution`, `PostTaskExecution`.
  - Tool matchers by category: `read`, `write`, `shell`, `web`, `spec`, `subagent`, `@mcp`, `@powers`. Maps 1:1 to ghost animations.
  - Spec task start/end events exist: drives the task wall directly.
  - Hook files: `.kiro/hooks/<id>.json`, action `{"type":"command"}`, event JSON on STDIN.
- [x] Kiro Crew per-agent events — kiro.dev/docs/crew/capabilities/hooks:
  - Fires `AgentSpawn`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`. Config in `~/.kiro/crew/hooks.json`, env `KIROCREW_HOOK_EVENT`, `KIROCREW_HOOK_CONTEXT`, JSON on stdin.
  - Task and file events do NOT fire in Crew 0.8. Use IDE/CLI hooks for the task wall.
  - One ghost per session id (verify the field name in a real event).
  - **Danger:** Crew `PreToolUse` fails closed. Any non-zero exit or timeout blocks the tool. Our hook must always `exit 0` and never wait on the bridge.
  - Crew can run Claude Code as its agent backend (Preview, Developer Mode).
- [x] Hook can run a shell command — yes. Use a non-blocking send, e.g. `curl -s -m 1 -X POST --data-binary @- http://127.0.0.1:8787/event || true`.
- [ ] Capture one real event JSON per trigger from Kiro and save as fixtures (needed for sim mode).
- [ ] Read Official Rules: other AI tools allowed? Brand rules for Kiro ghost look?
- [ ] Target Minecraft + Fabric version that WebScreen/MCEF supports.

If Kiro gives fewer events than the table above, fall back to: file save + prompt submit + agent stop, and infer the rest.

## 6. Who builds what (honest split for the write-up)

| Part | Built with |
|---|---|
| Spec (requirements, design, tasks) | Kiro spec mode |
| Hooks that send events + run tests | Kiro hooks |
| Steering docs (code style, project rules) | Kiro steering |
| Bridge + dashboard | Kiro (from the spec) |
| Fabric mod | Claude Code + you |
| Ghost models / textures | You (Blockbench) |

Commit often with clear messages so history matches the write-up.

## 7. Schedule

| Week | Dates | Goal |
|---|---|---|
| 1 | Nov 4–10 | Step 0 checks. Kiro spec + steering. Bridge receives real Kiro hook events. Fabric mod skeleton, one ghost entity spawns. |
| 2 | Nov 11–17 | Ghost moves to desk, glow states, name tag. Event-to-animation map working for 1 ghost. Dashboard v1. Request Kiro credits (by Dec 1). |
| 3 | Nov 18–24 | Multiple ghosts (Kiro Crew). Hats/tools models. Big wall screen in game. Multiplayer test with a friend. Sim mode. |
| 4 | Nov 25–Dec 1 | Haunted office build, effects, polish. Bug fixing. Record footage. |
| 5 | Dec 2–4 | Video (< 3 min), README, write-up, license, `.kiro` check, submit by Dec 3 to be safe. |

**Cut if late, in order:** extra jobs beyond 3 ghosts → in-game screen (keep browser dashboard) → effects.

## 8. Submission checklist

- [ ] Public GitHub repo, OSI license visible in About.
- [ ] `/.kiro` at repo root, not gitignored.
- [ ] Working app URL (dashboard + sim mode) + mod download + server address.
- [ ] Demo video < 3 min, public YouTube, no copyrighted music, no third-party logos.
- [ ] Description + Kiro usage write-up (specs, hooks, steering, Crew, MCP, what was tried).
- [ ] Credit WebScreen (MIT) if code used.
- [ ] Never claim "first ever".
- [ ] Optional bonuses: blog post, social post with `#KiroweenHackathon26`, Kiro Crew app.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Kiro exposes too few events | Step 0; fallback event set |
| In-game Chromium heavy / buggy | Browser dashboard always works |
| Judges won't install Minecraft | Sim-mode dashboard + strong video |
| Similar projects exist | Lead with Kiro-specific world (specs, hooks, steering) + multiplayer + wall screen |
| Minecraft trademark | No "Minecraft" in project name; follow Mojang usage guidelines |
