# Haunted Crew documentation

Haunted Crew turns Kiro agents into ghosts in Minecraft. A small Node **bridge** talks to Kiro, a Fabric **mod**
draws the ghosts and the console, and everything the agents do shows up in the world.

| Page | What it covers |
|---|---|
| [Architecture](architecture.md) | The three parts, the data flow, and why it is built this way. |
| [Bridge](bridge.md) | Every bridge module: ACP, agents, workflows, memory, database, routines, browser, backup. |
| [Workflows](workflows.md) | Lead delegation, templates, custom agents, the crew tools, mid-turn steering. |
| [Reviewed merges](merges.md) | Git worktrees per run, off-tree merge, the in-game diff review, conflict and rework ghosts. |
| [Screens and browser](screens.md) | The wall dashboard, live code, and the headless-Chrome browser pipeline. |
| [Minecraft mod](mod.md) | Ghost entities, the office, console, workflow editor, merge screen, rendering. |
| [Security](security.md) | Tokens, pairing, the git sandbox, approvals, privacy. |
| [Testing](testing.md) | The test suite and how to check the whole system. |
| [Recording a demo](demo.md) | A shot list for a two to three minute walkthrough. |

Quick start lives in the [main README](../README.md). The HTTP API table is in [bridge/README.md](../bridge/README.md).

<p align="center"><img src="screenshots/office.webp" alt="The Haunted Office" width="760"></p>
