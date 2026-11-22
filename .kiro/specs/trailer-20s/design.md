# Design: 20 s Blender trailer

- `build.py --shot N` builds shot N and renders its frames. `--still F` renders one frame.
- `structure.py` loads office.nbt into blocks (1 block = 1 m; Blender X,Y,Z = Minecraft x,-z,y).
- `ghost.py` builds the solid ghost crew. `ui.py` builds the floating UI panels.
- `cine.py` holds camera moves. `cut.py` joins shots. `sfx.py` lays the sound effects.
- `sheet.py` makes a contact sheet of stills for review.
- Pipeline: sheet at 240p, I approve, full render on Colab, ffmpeg encode (H.264, CRF 16), plus a share copy under 20 MB.
