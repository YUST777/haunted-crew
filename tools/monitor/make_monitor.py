#!/usr/bin/env python3
"""Turns monitor_parts.json (Blender "Monitor" collection) into a block model + 32x32 texture.

Blender: 1 unit = 1 px, block spans 0..16, front faces -Y (north). Block model: x, y up, z south.
Boxes named mon_screen get a glowing code texture on their north face and light_emission 15.
"""
import json
import random
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'mod/src/main/resources/assets/hauntedcrew'
TEX = 32
UV = 16 / TEX  # uv units per texel


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def main():
    parts = json.loads(Path(__file__).with_name('monitor_parts.json').read_text())['parts']
    img = Image.new('RGBA', (TEX, TEX), (0, 0, 0, 255))
    px = img.load()
    rng = random.Random(7)

    # 4x4 swatch per colour on the top rows.
    swatch = {}
    for p in parts:
        c = p['color']
        if c in swatch:
            continue
        i = len(swatch)
        sx, sy = (i % 8) * 4, (i // 8) * 4
        for x in range(4):
            for y in range(4):
                f = 1 + rng.uniform(-0.06, 0.06)
                px[sx + x, sy + y] = tuple(min(255, round(ch * f)) for ch in rgb(c)) + (255,)
        swatch[c] = (sx, sy)

    # Screen art at (0, 16): dark blue terminal with coloured code lines.
    bg, colours = (14, 22, 48), [(120, 200, 255), (130, 255, 170), (255, 210, 120), (200, 160, 255)]
    for x in range(TEX):
        for y in range(16, 32):
            px[x, y] = bg + (255,)
    for row in range(17, 31, 2):
        indent = rng.choice([1, 1, 3, 5])
        length = rng.randint(6, 22)
        col = rng.choice(colours)
        for x in range(indent, min(TEX - 1, indent + length)):
            if rng.random() > 0.15:
                px[x, row] = col + (255,)
    for y in range(28, 31):  # cursor
        px[3, y] = (255, 255, 255, 255)

    def swatch_uv(c):
        sx, sy = swatch[c]
        return [(sx + 1) * UV, (sy + 1) * UV, (sx + 3) * UV, (sy + 3) * UV]

    elements = []
    for p in parts:
        (bx, by, bz) = (p['pivot'][i] + p['min'][i] for i in range(3))
        sx, sy, sz = p['size']
        frm = [round(bx, 3), round(bz, 3), round(by, 3)]
        to = [round(bx + sx, 3), round(bz + sz, 3), round(by + sy, 3)]
        faces = {d: {'uv': swatch_uv(p['color']), 'texture': '#monitor'} for d in ('north', 'south', 'east', 'west', 'up', 'down')}
        el = {'from': frm, 'to': to, 'faces': faces}
        if p['name'] == 'mon_screen':
            faces['north'] = {'uv': [0, 8, 16, 16], 'texture': '#monitor'}
            el['light_emission'] = 15
            el['shade'] = False
        elements.append(el)

    model = {
        'parent': 'minecraft:block/block',
        'ambientocclusion': False,
        'textures': {'monitor': 'hauntedcrew:block/monitor', 'particle': 'hauntedcrew:block/monitor'},
        'elements': elements,
    }
    (ASSETS / 'models/block').mkdir(parents=True, exist_ok=True)
    (ASSETS / 'textures/block').mkdir(parents=True, exist_ok=True)
    (ASSETS / 'models/block/monitor.json').write_text(json.dumps(model, indent=1))
    img.save(ASSETS / 'textures/block/monitor.png')
    print(f'{len(elements)} elements')


if __name__ == '__main__':
    main()
