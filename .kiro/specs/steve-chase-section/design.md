# Design: Steve chase section

## Overview

A new `ChaseSection` component placed after `FeaturesSection` in `landing_page/site/src/routes/index.tsx`. Its 3D part is
a separate lazy chunk (`ChaseScene`) loaded with `React.lazy` when an `IntersectionObserver` sees the section within one
screen of the viewport.

```text
ChaseSection (static: heading, sentence, poster image, reduced-motion still)
  └─ lazy ChaseScene (three.js canvas)
       ├─ Steve   : steve.glb, six rigid parts (head, torso, arm_l, arm_r, leg_l, leg_r)
       └─ Ghost x6: built from ghost.json + ghost.png, one per job
```

## Assets

| Asset | Made by | Notes |
|---|---|---|
| `public/assets/chase/steve.glb` | `tools/hero/build_steve.py` (Blender 5.2 through MCP for Blender) | Six rigid parts with origins on the joints (neck, shoulders, hips); 512 px skin; no baked animation. |
| `public/assets/chase/ghost.json`, `ghost.png` | Copy of the mod's model files (`cp` in a build script, not by hand) | Same data the game renders. |
| `public/assets/chase/chase-poster.webp` | Screenshot of the finished scene | Shown while loading, without WebGL, and under reduced motion. |

The ghost model is boxes with UVs (`from`, `size`, `uv`, `pivot`, `rotation`), so the site builds `THREE.BoxGeometry`
meshes from the JSON at runtime instead of shipping six GLBs. Accessories named `acc_<job>_*` are shown only for that
ghost's job, exactly as `GhostModel.java` does.

## Animation (code, no baked clips)

- **Run cycle:** `legL.rotation.x = sin(t*k) * 0.9`, `legR` in anti-phase, arms opposite to legs, torso bob `abs(sin)*0.05`.
- **Pickaxe swing:** right arm raised, forearm swings `sin(t*k*0.5)` over the head.
- **Ghosts:** body bob `sin(t*0.1)*2.4` as in the mod; fleeing means moving away at 1.1x Steve's speed with a lateral
  shake and the "waiting" yellow tint on the nearest ghost.
- **Loop:** a looping timeline of about 8 s: Steve enters, ghosts scatter off the opposite edge, short pause, repeat.

## Loading and fallbacks

| Case | Behaviour |
|---|---|
| Section not near the viewport | Nothing is fetched. The poster shows. |
| No WebGL | The poster stays. |
| `prefers-reduced-motion: reduce` | The poster stays; the scene never starts. |
| Section leaves the viewport | `frameloop="never"` or `renderer.setAnimationLoop(null)`. |
| Model fails to load | The poster stays; the error is logged once. |

## Key decisions

- **Own chunk.** The hero was kept 2D and small on purpose; three.js is about 1 MB. `build.chunkSizeWarningLimit` is already raised for it.
- **Rigid parts, not a skeleton.** The Sketchfab rig would not export cleanly (a mesh landed 700 units off). Six parts
  on joints give a Minecraft-accurate run with no skinning.
- **Ghosts from the mod's JSON.** The ghosts then match the game and cost 14 KB instead of six GLBs.
- **Poster first.** The visitor never sees an empty box.

## Testing strategy

- Typecheck and build (`tools/kiro/check.sh site`).
- Headless browser: scroll to the section, wait, capture two canvas frames and check they differ; repeat with
  `reducedMotion: 'reduce'` and check they are identical; load at 1440 x 900 and 390 x 844 and check no horizontal scroll.
- Network log: check that no three.js request happens before the section is near the viewport.
