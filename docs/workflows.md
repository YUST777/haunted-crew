# Workflows

Press **K → Workflows** in Minecraft, or open the `/workflows` link the launcher prints.

<p align="center"><img src="screenshots/workflows.webp" alt="The workflow editor" width="760"></p>

## Building blocks

- **Start** holds the task. **End** collects the final result.
- **Agent boxes** become ghosts. Each has a name, job, model and instructions, and may load a `SKILL.md`.
- **Arrows** define order. Boxes whose inputs are ready run in parallel; each gets the task plus the results of the
  boxes before it.

## Lead delegation

Mark one agent box as the lead and connect it to teammates. At run time:

1. The lead gets the task and its roster, and replies with an assignment such as `{"assign":[{"to":"Coder","task":"…"}]}`.
2. The bridge sends each task to the teammate, waits for a `Status / Result / Evidence` reply and hands the results back.
3. The lead assigns more work (for example Tester and Reviewer in parallel) or finishes with `{"done":"…"}`.

Teammates can ask each other for help; a lock stops endless chains.

## Templates

Lead delegates, Feature (plan → code → test → review), Bug fix, Parallel code + docs, Research brief.

## Crew tools

Every ghost gets a `crew` MCP server, with a text-protocol fallback when a model ignores tools.

| Tool | Does |
|---|---|
| `send_message`, `list_agents` | Ask a working teammate and wait for the reply. |
| `ask_user` | Ask the player a question with options. |
| `remember`, `search_memories`, `forget_memory` | Long-term memory per agent. |
| `list_tables`, `query_data`, `execute_data`, `delete_table` | Shared SQLite database. |
| `history_search`, `history_read` | Search what the crew did before. |

**Mid-turn steering:** notes sent to a running agent are appended to its next tool result as `[NEW MESSAGES]`, so it
changes course without waiting for the turn to end.

## Routines and channels

Routines start a workflow on a timer (`every 30m`, `daily 09:00`) or from a signed webhook. Channels are shared
rooms; address anyone in chat with `@Name message`.

<p align="center"><img src="screenshots/mention.webp" alt="Talking to a ghost with @Name" width="760"></p>
