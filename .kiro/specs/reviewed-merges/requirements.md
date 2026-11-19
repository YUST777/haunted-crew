# Requirements: Reviewed merges

## Introduction

Console ghosts can edit code. A user should be able to let a crew work on a real repository without any agent touching
their checkout or branch until they have read the diff and approved it in Minecraft. With `--worktrees`, each workflow
run works in its own git worktree on its own branch, and the code reaches the user's branch only through an explicit Merge.

Reference: `docs/merges.md`, `bridge/src/worktrees.mjs`.

## Requirements

### Requirement 1: Isolate each run

**User story:** As a developer, I want a crew to work apart from my checkout, so that a bad run cannot damage my work in progress.

#### Acceptance criteria

1. WHEN the launcher starts with `--worktrees` inside a git repository THEN each workflow run SHALL get a worktree at
   `.haunted-crew/worktrees/<run>` on branch `haunted-crew/<run>`.
2. WHEN the project is not a git repository THEN the launcher SHALL print a notice and continue without worktrees.
3. WHEN the project is on a detached HEAD THEN creating a worktree SHALL fail with a message to check out a branch first.
4. WHILE a run is active THE user's checkout SHALL stay unchanged.
5. Agents SHALL not be able to push or fetch: network git protocols are disabled and push URLs are blocked.

### Requirement 2: Review before anything lands

**User story:** As a developer, I want to read what the crew changed before I accept it, so that I decide what goes into my branch.

#### Acceptance criteria

1. WHEN a run ends with changes THEN the system SHALL commit them on the run branch and mark the merge `pending`.
2. WHEN a run ends with no changes THEN the system SHALL not create a pending merge.
3. WHEN the user opens K > Merges THEN the screen SHALL list pending runs with files and line counts, and show the
   coloured diff of the selected run.
4. The diff endpoint SHALL cut the diff at 200 000 characters.

### Requirement 3: Merge safely

**User story:** As a developer, I want a merge to be all or nothing, so that I never end up with a half-merged checkout.

#### Acceptance criteria

1. WHEN the user chooses Merge and the checkout has uncommitted changes THEN the system SHALL refuse with code `dirty`
   and change nothing.
2. WHEN the user chooses Merge and the branches would conflict THEN the system SHALL change nothing and start a Resolver
   ghost, and the run SHALL come back for review with the note "Resolver finished: review again".
3. WHEN the user chooses Merge and there are no conflicts THEN the system SHALL build the merge commit off-tree
   (`git merge-tree --write-tree`, `git commit-tree`) and move the branch with `merge --ff-only`.
4. IF the run branch has no commits ahead THEN the system SHALL refuse with code `empty`.
5. Errors SHALL carry one of the codes `dirty`, `conflict`, `empty`, `refused`, `failed`, and a reason.

### Requirement 4: Reject and request changes

**User story:** As a developer, I want to send work back or throw it away, so that review is not just yes or no.

#### Acceptance criteria

1. WHEN the user chooses Reject THEN the system SHALL remove the worktree and delete the branch.
2. WHEN the user chooses Request changes with a note THEN a fresh Reviser ghost SHALL rework the branch with that note,
   and the run SHALL return for approval.
3. WHEN the user chooses Request changes with an empty note THEN the system SHALL answer HTTP 400 `say what should change`.

### Requirement 5: Only trusted people decide

**User story:** As a world owner, I want friends to watch merges but not approve them, so that only I can change my code.

#### Acceptance criteria

1. WHEN a request to `/api/merges/:run/answer` lacks the command token THEN the bridge SHALL answer HTTP 403.
2. WHEN worktrees are off THEN the bridge SHALL answer HTTP 503 `worktrees are off (start the bridge with --worktrees)`.
3. The mod SHALL check on the server that the player is the world owner or an operator before sending a merge answer.
