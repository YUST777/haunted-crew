# Haunted Crew website

Vite + React 19 + TanStack Router (file-based routes in `src/routes/`), plain CSS in `src/styles.css`.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/
npm run typecheck
npx wrangler pages deploy dist --project-name haunted-crew --branch main   # Cloudflare Pages
```

- `src/components/Hero.tsx`: background, fog, headline, showcase slot, setup card.
- `src/components/Ghosts.tsx`: the two hero ghost sprites (CSS float, sparks, pointer parallax).
- `src/components/CrewSection.tsx`: crew scene and the six-ghost roster.
- `src/components/FeaturesSection.tsx`: the draggable workflow board with redstone-dust wires.
- `src/components/SetupCard.tsx`: "Copy this to your Kiro" copies the fenced block from the repo's
  `INSTALL_PROMPT.md`, so the site and the docs stay in sync.
- `public/assets/`: webp art. Keep one size per viewport (`*-1280` / `*-1600` for small screens) so
  phones never download the large versions.
