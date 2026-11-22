# Testing

```bash
cd bridge && npm test      # node:test, 162 tests
```

| Area | Tests |
|---|---|
| ACP and agents | `agents`, `agent-env` (git sandbox), `fake-acp`, `fake-mcp-acp` scripted agents. |
| Workflows | `workflows`, `lead-e2e` (lead → teammates with a scripted team), `routines`, `channels`. |
| Merges | `worktrees` and `worktree-e2e` run real `git` in temp repos: merge, conflict, reject, dirty checkout. |
| Data | `memory`, `shared-data`, `history`, `backup`, `skillstore`, `edits`, `compaction`, `mailbox`. |
| Server | `server`, `pairing`, `preview` (real headless Chrome). |

## Whole-system check

1. `node bin/haunted-crew.mjs <git-project> --worktrees` and run the *Lead delegates* template.
2. Watch ghosts walk to desks; approve their tool calls.
3. Open **K → Merges**, read the diff and merge. Check `git log --graph` shows the merge commit.
4. Make a conflicting commit on `main` before merging to see the Resolver ghost.
5. Use **Request changes** to see the Reviser ghost rework the branch.
6. Open the browser screen, search, type and paste.

`--demo` runs the same flow with a scripted agent and needs no Kiro account.
