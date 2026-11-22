# Kiro in this repository

This folder holds the Kiro files used to build Haunted Crew: specs, steering and hooks. It is separate from what
Haunted Crew writes into a user's project (the launcher creates `<project>/.kiro/hooks/haunted-crew.json` and
`<project>/.kiro/agents/haunted-crew.json`; see `docs/kiro-integration.md`).

```text
.kiro/
  specs/      requirements, design and tasks for three features
  steering/   nine rules files that shape every Kiro session in this repo
  hooks/      fifteen hooks: ten forward events to the bridge, five protect and check the work
```

## Specs

Each spec has `requirements.md` (user stories with EARS acceptance criteria), `design.md` and `tasks.md`. Task
checkboxes show what is done. Open tasks are real gaps, not decoration.

| Spec | State | What it covers |
|---|---|---|
| `specs/hook-event-bridge/` | Built. Tasks 1 to 7 done, 8 to 10 open (real Kiro payload fixtures, limiter 429 test, session state tests). | Installing hooks, forwarding metadata only, mapping events to ghost status, auth. |
| `specs/reviewed-merges/` | Built. Tasks 1 to 9 done, 10 to 12 open (detached HEAD, Request changes and Resolver, 503 without worktrees). | Worktree per run, diff review in Minecraft, safe merge, reject, request changes. |
| `specs/steve-chase-section/` | Not built: left out of the hackathon scope. Kept as a future idea. | A 3D website section where Steve chases the six ghosts. |

How these specs were made: the first two were written after the code they describe, from the source and tests, then
checked against them. The test coverage statements list only what the test files really cover. The third was written
before any code. None of the specs claim more than the repository shows.

## Steering

| File | Inclusion | Subject |
|---|---|---|
| `product.md` | always | What Haunted Crew is, who it is for, the two kinds of ghosts, product rules. |
| `tech.md` | always | Stack, commands, the Kiro interfaces the code depends on. |
| `structure.md` | always | Repository layout and where new files go. |
| `privacy-and-safety.md` | always | Hook rules, what may leave the machine, tokens, git sandbox, rules for working on this repo. |
| `writing-style.md` | always | How docs, UI text and commit messages are written. |
| `bridge.md` | when a `bridge/` file is in context | Node conventions, event rules, tests. |
| `mod.md` | when a `mod/` file is in context | Fabric rules, ghost model pipeline. |
| `site.md` | when a `landing_page/site/` file is in context | Routes, look, checks before calling a change done. |
| `blender-assets.md` | when a `tools/` file is in context | Making assets with Blender through MCP, check by rendering. |

Steering files link to the reference docs with `#[[file:...]]`, so the docs stay the single source of truth.

## Hooks

Hooks are JSON files in `hooks/`. Ten forward Kiro events to the bridge, so Kiro sessions on this repo show up as
ghosts. Five protect and check the work.

| Hook | Trigger | Does |
|---|---|---|
| `haunted-crew-session-start`, `-user-prompt-submit`, `-stop`, `-pre-tool-use`, `-post-tool-use`, `-post-file-create`, `-post-file-save`, `-post-file-delete`, `-pre-task-exec`, `-post-task-exec` | the ten Kiro triggers | `node bridge/bin/send-event.mjs <Trigger>`: forwards metadata only, always exits 0, prints nothing. |
| `guard-shell` | `PreToolUse` on shell tools | `tools/kiro/guard-shell.mjs` blocks force pushes, `git reset --hard`, `git clean -f`, `git checkout .` and `rm -r` of the checkout or home (exit 2). |
| `bridge-tests-on-save` | `PostFileSave` on `bridge/{src,bin,test}` | `tools/kiro/check.sh bridge` (159 tests, a few seconds). |
| `site-typecheck-on-save` | `PostFileSave` on `landing_page/site/src` `.ts` and `.tsx` | `npm --prefix landing_page/site run typecheck`. |
| `tests-after-spec-task` | `PostTaskExec` | `tools/kiro/check.sh`: bridge tests, site typecheck and build, mod tests when JDK 25 is installed. |
| `docs-stay-true` | `PostFileSave` on bridge or mod source | Asks the agent to update `docs/*.md` when the change alters anything documented. |

`tools/kiro/check.sh` skips the mod when only an older JDK is installed and says so; it does not report a skipped
check as a pass.

The ten forwarding hooks also drive the Haunted Office: a Kiro session in this repo appears as a ghost, and a spec
task shows on the big screen's task wall (`PreTaskExec`, `PostTaskExec`).

## What these files are not

They do not prove who wrote the code. Kiro session history is a separate record; see the repository README for how
the project was built. They also do not mean Kiro emits exactly these trigger names: that is listed as not verified in
`docs/kiro-integration.md` until real payloads are captured (spec task 8 in `hook-event-bridge`).

## Video
- Specs: `specs/trailer-20s`, `specs/explainer-clips`, `specs/demo-edit`
- Steering: `steering/video-style.md`, `steering/video-render.md`
- Hooks: `hooks/video-trailer-on-save.json`, `hooks/video-clips-on-save.json`, `hooks/video-edit-on-save.json`
- Code: `video/trailer` (Blender), `video/clips` (HyperFrames), `video/edit` (ffmpeg)
