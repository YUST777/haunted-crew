---
inclusion: fileMatch
fileMatchPattern: 'video/**'
---

# Video render rules

- Never render Blender on this laptop (MX450 GPU). Use Colab or the remote GPU.
- ffmpeg and HyperFrames may run locally.
- Make a 240p preview or a still sheet first. Wait for approval before a full render.
- In ffmpeg always write durations with a leading zero: 0.4, never .4.
- Colab uploads: split files into 40 MB parts.
- Never read or print `.env` files or API keys.
