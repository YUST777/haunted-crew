---
inclusion: fileMatch
fileMatchPattern: 'bridge/**'
---

# Working on the bridge

Reference: #[[file:docs/bridge-reference.md]] and #[[file:docs/kiro-integration.md]].

## Code conventions

- Node ESM (`.mjs`), no TypeScript, no build step. Node built-ins first (`node:fs`, `node:http`, `node:test`).
- Ask before adding a dependency. The only runtime dependencies are `ws` and `puppeteer-core`, and Chrome is optional.
- One concern per module in `src/`. Modules export plain functions or a small factory; no classes unless there is
  state to hold.
- Every HTTP endpoint checks its token role first (view, command or ingest) and returns a JSON error with a reason.
- Limits are named constants at the top of the module (`MAX_AGENTS`, `MAX_REPLY`, ...) and documented in
  `docs/bridge-reference.md`.

## Events

- Hook events and ACP updates end up as the same event shape. If you add an event kind, add it to `normalize.mjs`,
  `state.mjs`, the mod's `CrewProtocol`, and the event table in the docs.
- Unknown hook triggers are rejected with HTTP 400 `unknown trigger`. Keep the alias list in `normalize.mjs` in sync
  with the spellings Kiro uses.

## Tests

- Every module has `test/<module>.test.mjs` using `node:test` and `node:assert/strict`.
- Use the scripted agents (`test/fake-acp.mjs`, `fake-mcp-acp`) instead of a real `kiro-cli`. Tests must pass with no
  Kiro account, no network and no Chrome (tests that need Chrome skip themselves).
- Git tests run real `git` in temp folders. Never touch the developer's checkout from a test.
- `npm --prefix bridge test` must stay green. The `bridge-tests-on-save` hook runs it after every save.
