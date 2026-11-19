---
inclusion: fileMatch
fileMatchPattern: 'mod/**'
---

# Working on the Fabric mod

Reference: #[[file:docs/mod-reference.md]] and #[[file:docs/mod.md]].

## Targets

- Minecraft 26.3, Fabric Loader + Fabric API, Java 25. Use Mojang mappings names as they appear in the existing
  code (`Identifier`, `ModelPart`, `PoseStack`).
- Server and shared code in `src/main/java/dev/hauntedcrew/`; anything that touches rendering, screens or input in
  `src/client/java/dev/hauntedcrew/client/`. Server code must never import a client class.

## Rules

- The mod never runs `kiro-cli` and never holds Kiro credentials. It talks to the bridge over HTTP (command token)
  and listens on the WebSocket.
- Only the world owner and operators can command ghosts. Every console action is checked on the server, not only
  hidden in the UI.
- All screens share one look: dark panel, grey bars, black outlines, stone-style buttons. Reuse the helpers in the
  existing screens instead of drawing new styles.
- Network and decoding work (screen JPEG frames, bridge calls) stays off the render thread.

## Ghost model

- `assets/hauntedcrew/models/entity/ghost.json` and `textures/entity/ghost.png` are generated. Do not hand-edit them:
  change `tools/ghost/ghost.blend`, export with `tools/ghost/blender_export.py`, then run
  `python3 tools/ghost/paint_ghost.py`.
- Model units are 1/32 block (drawn at 0.5 scale). Accessories are named `acc_<job>_<part>` and only show for that job.

## Tests

- JUnit tests in `src/test/java/dev/hauntedcrew/` cover config and protocol parsing. Add a test when you change
  `CrewProtocol` or `CrewConfig`.
- `./gradlew build` needs JDK 25. `tools/kiro/check.sh` skips the mod when JDK 25 is missing and says so.
