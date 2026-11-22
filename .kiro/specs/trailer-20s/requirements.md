# Requirements: 20 s Blender trailer

1. WHEN the trailer is built THE SYSTEM SHALL produce a 20 s video at 30 fps in 16:9.
2. THE SYSTEM SHALL build every shot from one Python script (`video/trailer/build.py`) with no manual Blender steps.
3. THE SYSTEM SHALL use the game's real office (`video/trailer/office.nbt`) and the real ghost model.
4. THE ghosts SHALL be solid (never transparent).
5. THE last shot SHALL show the HAUNTED CREW logo and the line "Your Kiro agents, haunting Minecraft."
6. THE logo shot SHALL hold still for at least 1.5 s so one frame can be the YouTube thumbnail.
7. THE SYSTEM SHALL NOT render on the local laptop (MX450). Renders run on Colab or a remote GPU.
8. BEFORE a full render THE SYSTEM SHALL make a still sheet (`video/trailer/sheet.py`) for review.
