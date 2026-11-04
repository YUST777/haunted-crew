#!/usr/bin/env python3
"""Turns ghost_parts.json (from blender_export.py) into the mod's model JSON and pixel texture.

Usage: python3 tools/ghost/paint_ghost.py
Writes mod/src/main/resources/assets/hauntedcrew/{models/entity/ghost.json,textures/entity/ghost.png}.

Coordinates: Blender (x right, y back, z up, 1 unit = 1/32 block, ground z=0) ->
Minecraft model space (x, y down, z; ground at y=24). The model is drawn at half scale, so every
unit gets one texel: twice the pixel density of vanilla mobs.
"""
import json
import math
import random
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PARTS = Path(__file__).with_name('ghost_parts.json')
ASSETS = ROOT / 'mod/src/main/resources/assets/hauntedcrew'


def to_mc_vec(v):
    return [v[0], -v[2], v[1]]


def rgb(hexc):
    return tuple(int(hexc[i:i + 2], 16) for i in (0, 2, 4))


def shade(c, f):
    return tuple(max(0, min(255, round(ch * f))) for ch in c)


def pack(rects, width):
    """Shelf packer. rects: list of (key, w, h). Returns ({key: (u, v)}, height)."""
    order = sorted(rects, key=lambda r: (-r[2], -r[1]))
    pos, x, y, shelf = {}, 0, 0, 0
    for key, w, h in order:
        if w > width:
            raise ValueError(f'{key} is wider than the texture')
        if x + w > width:
            x, y, shelf = 0, y + shelf, 0
        pos[key] = (x, y)
        x += w
        shelf = max(shelf, h)
    return pos, y + shelf


def main():
    parts = json.loads(PARTS.read_text())['parts']
    by_name = {p['name']: p for p in parts}

    # Box size in texels (Minecraft order: width=x, height=y, depth=z).
    boxes = {}
    for p in parts:
        sx, sy, sz = p['size']
        boxes[p['name']] = (sx, sz, sy)  # w, h, d
    rects = [(n, math.ceil(2 * d + 2 * w), math.ceil(d + h)) for n, (w, h, d) in boxes.items()]
    for width in (128, 256):
        uv, height = pack(rects, width)
        if height <= width:
            break
    height = 1 << max(5, math.ceil(math.log2(height)))
    tex = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    px = tex.load()
    rng = random.Random(1031)

    def face(x0, y0, w, h, color, kind):
        x0, y0 = math.floor(x0), math.floor(y0)
        W, H = max(1, math.ceil(w)), max(1, math.ceil(h))
        for j in range(H):
            for i in range(W):
                f = {'top': 1.12, 'bottom': 0.78}.get(kind, 1.05 - 0.15 * (j / max(1, H - 1)))
                if W >= 3 and H >= 3 and (i in (0, W - 1) or j in (0, H - 1)):
                    f *= 0.93
                f *= 1 + rng.uniform(-0.025, 0.025)
                px[x0 + i, y0 + j] = shade(color, f) + (255,)

    for name, (w, h, d) in boxes.items():
        u, v = uv[name]
        c = rgb(by_name[name]['color'])
        face(u + d, v, w, d, c, 'top')
        face(u + d + w, v, w, d, c, 'bottom')
        face(u, v + d, d, h, c, 'side')
        face(u + d, v + d, w, h, c, 'side')  # north = front
        face(u + d + w, v + d, d, h, c, 'side')
        face(u + 2 * d + w, v + d, w, h, c, 'side')

    # Face on the body's front.
    u, v = uv['body']
    w, h, d = boxes['body']
    fx, fy = u + d, v + d
    dark, white, blush = (26, 20, 38, 255), (255, 255, 255, 255), (247, 168, 192, 255)
    for ex in (4, 10):
        for j in range(4):
            for i in range(2):
                px[fx + ex + i, fy + 4 + j] = dark
        px[fx + ex, fy + 4] = white
    for i in range(2):
        for j in range(2):
            px[fx + 7 + i, fy + 9 + j] = dark
    for bx in (2, 12):
        px[fx + bx, fy + 8] = blush
        px[fx + bx + 1, fy + 8] = blush

    # Parts, parents first, pivots relative to the parent (Minecraft PartPose semantics).
    out, done = [], set()

    def emit(p):
        if p['name'] in done:
            return
        if p['parent']:
            emit(by_name[p['parent']])
        piv = p['pivot']
        if p['parent']:
            ppiv = by_name[p['parent']]['pivot']
            offset = to_mc_vec([piv[i] - ppiv[i] for i in range(3)])
        else:
            offset = [piv[0], 24 - piv[2], piv[1]]
        mn, (w, h, d) = p['min'], boxes[p['name']]
        rx, ry, rz = (math.radians(a) for a in p['rotation_deg'])
        out.append({
            'name': p['name'],
            'parent': p['parent'],
            'pivot': [round(a, 4) for a in offset],
            'rotation': [round(rx, 5), round(-rz, 5), round(ry, 5)],
            'from': [round(mn[0], 4), round(-(mn[2] + h), 4), round(mn[1], 4)],
            'size': [round(w, 4), round(h, 4), round(d, 4)],
            'uv': list(uv[p['name']]),
        })
        done.add(p['name'])

    for p in parts:
        emit(p)

    (ASSETS / 'models/entity').mkdir(parents=True, exist_ok=True)
    (ASSETS / 'textures/entity').mkdir(parents=True, exist_ok=True)
    (ASSETS / 'models/entity/ghost.json').write_text(json.dumps({'texture': [width, height], 'scale': 0.5, 'parts': out}, indent=1))
    tex.save(ASSETS / 'textures/entity/ghost.png')
    print(f'{len(out)} parts, texture {width}x{height}')


if __name__ == '__main__':
    main()
