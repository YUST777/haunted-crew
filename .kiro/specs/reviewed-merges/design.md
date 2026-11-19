# Design: Reviewed merges

## Overview

```text
run starts ──► worktrees.create(run) ──► ghosts work in .haunted-crew/worktrees/<run> (branch haunted-crew/<run>)
run ends   ──► commit on the run branch ──► merge status "pending"
user (K > Merges) ──► GET /api/merges, GET /api/merges/:run/diff
                  └─► POST /api/merges/:run/answer { option: Merge | Reject | Request changes }
```

## Components

| Component | File | Responsibility |
|---|---|---|
| Worktrees | `bridge/src/worktrees.mjs` | create, commit, check, merge, reject. Runs real `git`. Throws `MergeError(code, reason)`. |
| Workflow runner | `bridge/src/workflows.mjs` | Starts the run in the worktree, starts the Resolver and Reviser ghosts, stores merge state on the run. |
| Run store | `bridge/src/runstore.mjs` | Keeps run records (50 newest), including `merge` status. |
| HTTP | `bridge/src/server.mjs` | `/api/merges`, `/api/merges/:run/diff`, `/api/merges/:run/answer`. |
| Mod screen | `mod/.../client/MergeScreen.java` | Pending list, coloured diff, three buttons. |
| Mod server | `mod/.../ConsoleService.java` | Checks the player is trusted, forwards `merge_*` actions to the bridge. |

## Merge algorithm

1. Refuse when the worktree is not `active` (code `refused`).
2. Refuse when the user's checkout is dirty (code `dirty`).
3. Run `git merge-tree --write-tree`. If it reports conflicts, return code `conflict` with the file list. Any other
   failure returns `failed`.
4. If the run branch is not ahead of the base, code `empty`.
5. `git commit-tree` builds the merge commit from the tree, then `git merge --ff-only` moves the user's branch to it.
   The merge never touches the working tree before step 5, so a failure leaves nothing half-done.

## Error handling

| Code | Meaning | What the user sees |
|---|---|---|
| `dirty` | Uncommitted changes on the base branch | "commit or stash them, then approve again" |
| `conflict` | Merge would conflict | A Resolver ghost merges the base into the run branch; the run returns for review |
| `empty` | Nothing to merge | Message from `worktrees.mjs` |
| `refused` | Worktree not active, or detached HEAD | Message from `worktrees.mjs` |
| `failed` | git failed | Git's own message |

## Key decisions

- **Merge off-tree, then fast-forward.** The user's checkout is only touched by a `--ff-only` move that git can refuse cleanly.
- **Branch kept after merge, deleted on reject.** The merged branch stays as a record.
- **Agents cannot reach the network.** The git sandbox in `agentEnv()` (see `docs/kiro-integration.md`) means even an
  approved branch cannot be pushed by an agent.
- **Resolver and Reviser are ordinary ghosts.** They reuse the console-agent path, so approvals and chat work the same.

## Testing strategy

Covered today:

- `bridge/test/worktrees.test.mjs` (3 tests, real git in temp repositories): agent edits stay off the user's checkout until
  the merge is approved and the result is a real two-parent merge commit; no changes means nothing to review and reject
  removes the branch and folder; a dirty checkout and conflicts are refused with the reason.
- `bridge/test/worktree-e2e.test.mjs`: a scripted agent edits a file on its own branch, the run becomes `pending`, the
  merge list and diff are served, a view token cannot approve (403), and the command token's Merge lands the change.
- Mod screens are checked by hand in a Haunted Office world (`docs/testing.md`, whole-system check, steps 3 to 5).

Not covered yet (open tasks 10 to 12 in `tasks.md`): a detached HEAD, Request changes and the Reviser ghost, the Resolver
ghost after a conflict, the empty-note 400, and the HTTP 503 when the bridge runs without `--worktrees`.
