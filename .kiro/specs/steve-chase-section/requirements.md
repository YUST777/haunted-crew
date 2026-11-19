# Requirements: Steve chase section

## Introduction

The website needs one more memorable moment after the workflows section: Minecraft's Steve runs with a pickaxe at the six
Haunted Crew ghosts (Planner, Coder, Tester, Reviewer, Docs, Researcher), and the ghosts flee. It uses the mod's own
ghost model and texture so the ghosts match the game. The hero stays 2D; this section is 3D and must not slow the first paint.

Status: planned. The Steve model, `landing_page/site/public/assets/chase/steve.glb`, exists but has not been checked
(the last render of it came out empty).

## Requirements

### Requirement 1: Show the chase

**User story:** As a visitor, I want to see Steve chase the ghosts, so that the page shows the game's humour and the crew at once.

#### Acceptance criteria

1. WHEN the section scrolls into view THEN the system SHALL play the chase: Steve runs from one side swinging a pickaxe
   while the six ghosts flee ahead of him, each shaking.
2. WHEN the chase ends THEN the system SHALL loop it after a short pause.
3. The ghosts SHALL be built from `mod/src/main/resources/assets/hauntedcrew/models/entity/ghost.json` and
   `textures/entity/ghost.png`, each with its job's accessories.
4. Steve SHALL show the classic skin (cyan shirt, blue trousers) and a diamond pickaxe.

### Requirement 2: Keep the page fast

**User story:** As a visitor on a phone, I want the page to load quickly, so that a 3D section does not cost me the first screen.

#### Acceptance criteria

1. The three.js code and the models SHALL load in their own chunk, only when the section is near the viewport.
2. The first-paint JavaScript SHALL stay under 100 KB gzipped.
3. WHILE the section is off screen THE render loop SHALL be paused.
4. IF WebGL is not available THEN the section SHALL show a still image of the chase.
5. The 3D assets SHALL total under 1.5 MB.

### Requirement 3: Respect the visitor

**User story:** As a visitor who dislikes motion, I want the chase to hold still, so that the page does not make me uncomfortable.

#### Acceptance criteria

1. WHEN `prefers-reduced-motion: reduce` is set THEN the system SHALL show a still frame and not animate.
2. The section SHALL not capture scrolling or keyboard focus.
3. The canvas SHALL be hidden from assistive technology, and the section SHALL have a text heading and one sentence describing the scene.

### Requirement 4: Fit every screen

**User story:** As a visitor on any device, I want the whole chase visible, so that nobody is cut off.

#### Acceptance criteria

1. WHEN the viewport is 1440 x 900 THEN all six ghosts and Steve SHALL be visible at the same time.
2. WHEN the viewport is 390 x 844 THEN the section SHALL fit the width without horizontal scrolling.
3. WHEN the window is resized THEN the scene SHALL rescale without reloading the models.

### Requirement 5: Credit and license the model

**User story:** As the author, I want the Steve model credited, so that I follow its license.

#### Acceptance criteria

1. The credits SHALL name the Sketchfab model "Perfect Steve Revised" by Blender3D (CC Attribution) with a link.
2. `tools/hero/build_steve.py` SHALL keep that attribution in its header.
