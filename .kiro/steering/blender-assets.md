---
inclusion: fileMatch
fileMatchPattern: 'tools/**'
---

# Making assets with Blender

The ghost, monitor, office and website models are made in Blender 5.2, usually driven by Kiro through MCP for Blender
(https://github.com/ahujasid/mcp-for-blender). Blender must be open with the addon's server running on
`localhost:9876`. `tools/hero/bmcp.py <script.py>` runs a script in the open Blender over the same socket.

## Rules

- Every asset is made by a script in `tools/`, with a header comment that says how to run it and which files it
  writes. Rerunning the script must reproduce the asset; no hand edits in Blender that the script does not know about.
- Check your work by rendering it. After each change render a close-up and a full shot
  (`tools/hero/render_check.py`) and compare them with the reference image before moving on. A clean export is not
  proof that the model looks right.
- Save the `.blend` after each step. Blender has closed on its own during long MCP sessions and the scene was lost.
- Voxel style: one voxel per texel, flat shading, no smoothing. Mod models use 1/32-block units and only boxes
  (see `tools/ghost/blender_export.py` for the modelling rules).
- Third-party models (Sketchfab, Poly Haven) must be CC0 or CC Attribution. Write the author, link and licence in the
  script header and in the credits.
