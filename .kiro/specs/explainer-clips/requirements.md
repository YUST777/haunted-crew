# Requirements: HyperFrames explainer clips

1. THE SYSTEM SHALL make two clips with HyperFrames (HTML + GSAP rendered to video).
2. Clip "crew" SHALL be 12 s: ghost agents with named cursors build the landing page live.
3. Clip "workflow" SHALL be 15 s: an image agent makes a ref sheet and storyboard, gives them to Opus, Opus writes the Blender scene, then render, then the real reel with its real view count.
4. BOTH clips SHALL use the Minecraft font for titles, Inter for UI text, a charcoal background, one teal accent and a white glow.
5. THE animation SHALL be deterministic: all motion in `window.__timelines["main"]`, no unseeded random.
6. BEFORE rendering THE SYSTEM SHALL pass `npx hyperframes check` and `npx hyperframes lint`.
