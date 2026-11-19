---
inclusion: always
---

# Product: Haunted Crew

Haunted Crew shows Kiro coding agents as ghosts in a haunted Minecraft office. You watch them read, write and run
things, they float over when they need you, and you talk to them in an in-game chat console. Friends can join the
server and watch the crew work.

Hackathon: Kiroween 2026, category Frankenstein (Minecraft + Kiro agents + live web dashboard + multiplayer).
Deadline Fri Dec 4, 2026, 2:00 PM PT. The full plan is #[[file:PLAN.md]].

## Who it is for

- Developers who run Kiro agents and want to see what they are doing without reading terminal walls.
- Friends on the same Minecraft server, who watch but cannot command ghosts.
- Judges, who may not install Minecraft: the dashboard, the `--demo` mode and the website must work on their own.

## The two kinds of ghosts

| Ghost | Comes from | Can you prompt it? |
|---|---|---|
| Hook ghost | A Kiro IDE or CLI session, reported by the hooks in `.kiro/hooks/` | No, watch-only |
| Console ghost | Started from the Minecraft console or a workflow box, as a `kiro-cli acp` session | Yes: chat, approvals, Stop, model switch |

Both look the same in the world because the bridge turns both into one event shape.

## The six jobs

Planner (wizard hat, scroll), Coder (hard hat, pickaxe), Tester (goggles, potion), Reviewer (detective hat,
magnifier), Docs (quill, book), Researcher (explorer hat, compass). A ghost's name picks its look.

Status colours, readable from far away: blue working, yellow waiting for you, red error, grey idle.

## Product rules

- Never claim "first ever". Do not use "Minecraft" in the project name; follow Mojang's usage guidelines.
- The ghost art is ours. Do not use Kiro's official logo art.
- Every feature must degrade cleanly: no Chrome means no browser screen, no git repo means no reviewed merges, and
  the rest keeps working.
- Ghost personalities are friendly. They are helpful ghosts, not monsters.
