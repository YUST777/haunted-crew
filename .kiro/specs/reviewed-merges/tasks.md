# Tasks: Reviewed merges

- [x] 1. Worktree per run
  - `worktrees.create`: worktree and branch, detached HEAD refusal, git-repo check in the launcher.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Git sandbox for agents
  - `agentEnv()` in `bridge/src/agents.mjs`: no network protocols, push URLs blocked, signing off, no prompts.
  - _Requirements: 1.5_

- [x] 3. Pending merge state
  - Commit run changes to the branch; store `merge` on the run record; skip runs with no changes.
  - _Requirements: 2.1, 2.2_

- [x] 4. Merge algorithm
  - [x] 4.1 Dirty-checkout and not-active refusals.
    - _Requirements: 3.1, 3.5_
  - [x] 4.2 Conflict detection with `git merge-tree --write-tree`.
    - _Requirements: 3.2, 3.5_
  - [x] 4.3 Off-tree merge commit and `--ff-only` move; `empty` refusal.
    - _Requirements: 3.3, 3.4_

- [x] 5. Reject and request changes
  - Reject removes worktree and branch; Request changes starts a Reviser ghost; empty note answers HTTP 400.
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 6. Resolver ghost for conflicts
  - Merge the base into the run branch, resolve, return the run for review with the Resolver note.
  - _Requirements: 3.2_

- [x] 7. HTTP API and roles
  - `GET /api/merges`, `GET /api/merges/:run/diff` (200 000 character cut), `POST /api/merges/:run/answer`; 403 and 503 cases.
  - _Requirements: 2.3, 2.4, 5.1, 5.2_

- [x] 8. Mod merge screen
  - `MergeScreen.java` with the pending list, coloured diff and three buttons; server-side trust check in `ConsoleService`.
  - _Requirements: 2.3, 5.3_

- [x] 9. Tests for what exists
  - `worktrees.test.mjs` and `worktree-e2e.test.mjs` (see the design for what each covers), including the 403 for a
    view token; bridge suite green.
  - _Requirements: 1.1, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 5.1_

- [ ] 10. Test a detached HEAD
  - In `worktrees.test.mjs`, check out a commit directly and expect creating a worktree to fail with the "check out a branch first" message.
  - _Requirements: 1.3_

- [ ] 11. Test Request changes and the Resolver
  - With the scripted team agent, answer a pending merge with Request changes (and with an empty note, expecting 400),
    and make a conflicting commit on the base branch to see the Resolver ghost start and the run return for review.
  - _Requirements: 3.2, 4.2, 4.3_

- [ ] 12. Test the 503 without `--worktrees`
  - Start the bridge without worktrees, call `POST /api/merges/x/answer`, expect 503 `worktrees are off (start the bridge with --worktrees)`.
  - _Requirements: 5.2_
