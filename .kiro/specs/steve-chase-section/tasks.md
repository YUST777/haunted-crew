# Tasks: Steve chase section

- [ ] 1. Check the Steve model
  - Render `tools/hero/build_steve.py` output from the front and the side in Blender; the six parts must stand upright,
    feet on the ground, joints at the neck, shoulders and hips. The last render came out empty, so find out why first.
  - _Requirements: 1.4_

- [ ] 2. Pickaxe
  - Add a voxel diamond pickaxe part to the Steve script, parented to the right hand, in the Minecraft item style.
  - _Requirements: 1.4_

- [ ] 3. Ghost model loader
  - [ ] 3.1 Copy `ghost.json` and `ghost.png` from the mod into `public/assets/chase/` with a script, not by hand.
    - _Requirements: 1.3_
  - [ ] 3.2 Build box meshes from the JSON (`pivot`, `rotation`, `from`, `size`, `uv`) and show only the job's `acc_<job>_*` parts.
    - _Requirements: 1.3_

- [ ] 4. Scene and animation
  - [ ] 4.1 Steve run cycle and pickaxe swing in code.
    - _Requirements: 1.1_
  - [ ] 4.2 Six ghosts fleeing with bob and shake; yellow tint on the nearest.
    - _Requirements: 1.1_
  - [ ] 4.3 About 8 s timeline that loops with a pause.
    - _Requirements: 1.2_

- [ ] 5. Section component and lazy loading
  - `ChaseSection` with heading, one descriptive sentence, poster, and `React.lazy` for `ChaseScene` behind an `IntersectionObserver`.
  - _Requirements: 2.1, 3.3_

- [ ] 6. Fallbacks and motion rules
  - Poster for no WebGL, reduced motion and load errors; pause the loop off screen.
  - _Requirements: 2.3, 2.4, 3.1, 3.2_

- [ ] 7. Responsive layout
  - Camera fit from the viewport; no horizontal scroll at 390 px; resize without reloading models.
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 8. Credits
  - Add the attribution to the footer or credits and to the Steve script header.
  - _Requirements: 5.1, 5.2_

- [ ] 9. Verify on localhost first
  - Run the dev server, then the headless-browser checks from the design. Show the result before any deploy.
  - _Requirements: 1 to 4_
