---
inclusion: always
---

# Tech stack and commands

| Part | Stack | Notes |
|---|---|---|
| Bridge (`bridge/`) | Node 22 ESM (`engines: >=20`), `ws`, `puppeteer-core` | Keep it dependency-light. No build step, no TypeScript. |
| Mod (`mod/`) | Fabric, Minecraft 26.3, Java 25, Gradle (Loom) | Split source sets: `src/main` (server + shared) and `src/client`. |
| Website (`landing_page/site/`) | Vite 8, React 19, TanStack Router (file routes), TypeScript | Deployed to Cloudflare Pages, project `haunted-crew`. |
| Assets (`tools/`) | Blender 5.2 + Python, driven through MCP for Blender | Scripts write straight into the mod's or the site's asset folders. |

## Commands

```bash
tools/kiro/check.sh                # every check below; the spec-task hook runs this
npm --prefix bridge test           # node:test, 159 tests
node bridge/bin/haunted-crew.mjs . --demo   # whole system with a scripted agent, no Kiro account
cd mod && ./gradlew build          # needs JDK 25
cd mod && ./gradlew runClient      # dev Minecraft client
npm --prefix landing_page/site run dev        # http://localhost:5173
npm --prefix landing_page/site run typecheck
npm --prefix landing_page/site run build      # also renders /docs to static HTML (prebuild)
```

Deploy the site (only when the user asks):

```bash
cd landing_page/site && npm run build && npx wrangler pages deploy dist --project-name haunted-crew --branch main
```

## Kiro interfaces the code depends on

- `kiro-cli acp` (Agent Client Protocol 1, JSON-RPC over stdio) for console ghosts: `bridge/src/acp.mjs`.
- `kiro-cli whoami`, `kiro-cli login --license free --use-device-flow`, `kiro-cli chat --no-interactive /usage`:
  `bridge/src/kiro.mjs`.
- Hook triggers `SessionStart`, `UserPromptSubmit`, `Stop`, `PreToolUse`, `PostToolUse`, `PostFileCreate`,
  `PostFileSave`, `PostFileDelete`, `PreTaskExec`, `PostTaskExec`: `bridge/bin/install-hooks.mjs`,
  `bridge/src/normalize.mjs`.

The reference for all of this is #[[file:docs/kiro-integration.md]].

## Defaults worth knowing

- Bridge binds `127.0.0.1:8787`. Default ghost model `claude-haiku-5.5`. Up to 70 ghosts, 4 `kiro-cli` processes.
- Ghosts start without the user's MCP servers unless `--mcp`, because Kiro starts every MCP server per session.
- Approval cards auto-deny after 10 minutes.
