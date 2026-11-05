# Haunted Crew website

Vite + React + TanStack Router (file-based routes in `src/routes/`). The hero ghosts are three.js
via `@react-three/fiber`, loaded lazily after the text.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/
npm run typecheck
```

- `src/components/Hero.tsx`: background, fog, headline, setup card.
- `src/components/GhostScene.tsx`: places, lights and animates the ghosts; wisps; pointer parallax.
- `src/components/SetupCard.tsx`: "Copy install prompt" copies the fenced block from the repo's
  `INSTALL_PROMPT.md`, so the site and the docs stay in sync.
- `public/assets/ghost-miner.glb`, `ghost-wizard.glb`: built in Blender by
  `tools/hero/build_hero_ghosts.py` (voxel models, each with a looping 4 s idle animation).
  To rebuild with Blender open and the MCP for Blender addon running:
  `python3 tools/hero/bmcp.py tools/hero/build_hero_ghosts.py`
