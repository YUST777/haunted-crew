#!/usr/bin/env python3
"""The Haunted Office wrapped in a gothic haunted mansion, as Minecraft commands (one per line).

Usage: python3 tools/office/build_mansion.py X Y Z > mansion.mcfunction
Run the lines on a server (RCON), then save with: /crew office save X Y Z X+56 Y+47 Z+59

The office room (build_office.py, 33 x 13 x 27) sits inside at (RX, RY, RZ). Around it, a
Second Empire style haunted house:
- palette: stone bricks (primary) / tuff bricks (secondary, close in tone) / dark oak (accent,
  a non-stone family so the masonry doesn't read as unfinished); roof in deepslate tiles
- depth: plinth, pillars, dark oak floor beams and cornice, framed windows with shutters,
  a recessed arched double door
- roof: a mansard (steep 2:1 lower slope, cresting on top) with dormers, so a 33-wide house
  keeps a roof rise in proportion; the front bay rises above it with its own gable
- silhouette: projecting entrance bay, two towers of different heights, off-centre chimneys
- lit: glowing windows, soul lanterns on the porch, lamp posts, fence lanterns
- grounds: red trees, graveyard, stone path, iron fence; spawn marker at the gate.
Building rules follow the build style guide of JesperMorais/minecraft-builder-claude-mcp-server.
"""
import contextlib
import io
import random
import sys

import build_office

W, H, D = 57, 48, 60
RX, RY, RZ = 12, 2, 6             # room origin inside the structure
RW, RH, RD = 33, 13, 27           # room size
WX0, WX1 = RX - 1, RX + RW        # facade planes (west, east)
WZ0, WZ1 = RZ - 1, RZ + RD        # facade planes (north, south)
TOP = 18                          # wall top; mansard starts at TOP + 1
BAY = (RX + 11, RX + 21)          # front bay (x range), protrudes to BAY_Z
BAY_Z = WZ1 + 5
BAY_TOP = TOP + 4
DOOR_X = RX + 16                  # left leaf of the double door (room x 16, 17)

# Facing toward the wall (upside-down stairs) and away from it (open trapdoors), per facade.
INTO = {('z', -1): 'east', ('z', 1): 'west', ('x', -1): 'south', ('x', 1): 'north'}
OUTOF = {('z', -1): 'west', ('z', 1): 'east', ('x', -1): 'north', ('x', 1): 'south'}


def main(ox, oy, oz):
    rnd = random.Random(1031)
    out = []

    def fill(x1, y1, z1, x2, y2, z2, block):
        out.append(f'fill {ox + x1} {oy + y1} {oz + z1} {ox + x2} {oy + y2} {oz + z2} {block}')

    def put(x, y, z, block):
        out.append(f'setblock {ox + x} {oy + y} {oz + z} {block}')

    def scatter(cells, y1, y2, share=0.12):
        """Sparse weathering on a stone face (about 1 block in 8)."""
        for x, z in cells:
            for y in range(y1, y2 + 1):
                if rnd.random() < share:
                    put(x, y, z, rnd.choice(('cracked_stone_bricks', 'tuff_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks')))

    def beam(x1, y, z1, x2, z2):
        fill(x1, y, z1, x2, y, z2, f'stripped_dark_oak_log[axis={"z" if x1 == x2 else "x"}]')

    # ------------------------------------------------------------ clear + grounds
    for y in range(0, H, 8):
        fill(0, y, 0, W - 1, min(H - 1, y + 7), D - 1, 'air')
    fill(0, 0, 0, W - 1, 0, D - 1, 'coarse_dirt')
    for _ in range(700):
        put(rnd.randrange(W), 0, rnd.randrange(D), rnd.choice(('podzol', 'rooted_dirt', 'podzol', 'packed_mud')))
    for x in range(WX0 - 4, WX1 + 5):                                       # soft ground line at the walls
        for z in range(WZ0 - 4, BAY_Z + 3):
            if rnd.random() < 0.35:
                put(x, 0, z, rnd.choice(('moss_block', 'podzol', 'moss_block')))

    # ------------------------------------------------------------ house body
    fill(WX0 - 1, 1, WZ0 - 1, WX1 + 1, 1, WZ1 + 1, 'cobbled_deepslate')       # plinth, 1 wider
    fill(WX0, 2, WZ0, WX1, TOP, WZ1, 'stone_bricks')
    fill(RX, RY + RH, RZ, RX + RW - 1, TOP, RZ + RD - 1, 'stone')              # attic mass above the room
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        build_office.main(ox + RX, oy + RY, oz + RZ)
    out.extend(l for l in buf.getvalue().splitlines() if 'metadata:"spawn"' not in l)  # spawn moves to the gate

    ring = [(WX0, z) for z in range(WZ0, WZ1 + 1)] + [(WX1, z) for z in range(WZ0, WZ1 + 1)] + \
           [(x, WZ0) for x in range(WX0, WX1 + 1)] + [(x, WZ1) for x in range(WX0, WX1 + 1)]
    scatter(ring, 3, TOP - 1)
    for a, b in (((WX0 - 1, WZ0 - 1), (WX1 + 1, WZ0 - 1)), ((WX0 - 1, WZ1 + 1), (WX1 + 1, WZ1 + 1)),
                 ((WX0 - 1, WZ0 - 1), (WX0 - 1, WZ1 + 1)), ((WX1 + 1, WZ0 - 1), (WX1 + 1, WZ1 + 1))):
        fill(a[0], 2, a[1], b[0], 2, b[1], 'polished_deepslate_slab[type=bottom]')   # plinth cap (ring only)
    for a, b in (((WX0, WZ0), (WX0, WZ1)), ((WX1, WZ0), (WX1, WZ1)), ((WX0, WZ0), (WX1, WZ0)), ((WX0, WZ1), (WX1, WZ1))):
        beam(a[0], 11, a[1], b[0], b[1])                                    # floor-line beams
        fill(a[0], TOP, a[1], b[0], TOP, b[1], 'dark_oak_planks')           # cornice

    def window(x, z, y1, y2, axis, out_dir, shutters=True):
        """2-wide window on a facade plane: glowing glass, dark oak lintel, sill and hood, shutters."""
        cells = [(x, z), (x + 1, z)] if axis == 'x' else [(x, z), (x, z + 1)]
        ix, iz = (0, -out_dir) if axis == 'x' else (-out_dir, 0)
        fx, fz = (0, out_dir) if axis == 'x' else (out_dir, 0)
        into = INTO[(axis, out_dir)]
        for cx, cz in cells:
            for y in range(y1, y2 + 1):
                put(cx, y, cz, 'white_stained_glass_pane')
                put(cx + ix, y, cz + iz, 'sea_lantern')
            put(cx + fx, y1 - 1, cz + fz, f'dark_oak_stairs[half=top,facing={into}]')   # sill
            put(cx + fx, y2 + 1, cz + fz, 'dark_oak_slab[type=top]')                   # hood
            put(cx, y2 + 1, cz, 'dark_oak_planks')                                     # lintel
        if shutters:
            side = [(x - 1, z), (x + 2, z)] if axis == 'x' else [(x, z - 1), (x, z + 2)]
            for sx, sz in side:
                for y in range(y1, y2 + 1):
                    put(sx + fx, y, sz + fz, f'dark_oak_trapdoor[open=true,facing={OUTOF[(axis, out_dir)]}]')

    LOW, UP = (6, 9), (13, 16)
    for z in range(RZ + 2, RZ + RD - 2, 6):                                  # west (bookshelves hide the lights)
        window(WX0, z, *LOW, 'z', -1)
        window(WX0, z, *UP, 'z', -1)
    for z1, z2 in ((8, 11), (14, 18), (20, 23)):                             # east: the room's real windows
        for z in range(RZ + z1, RZ + z2 + 1):
            for y in range(RY + 5, RY + 10):
                put(WX1, y, z, 'air')
        fill(WX1 + 1, RY + 4, RZ + z1, WX1 + 1, RY + 4, RZ + z2, 'dark_oak_stairs[half=top,facing=west]')
        fill(WX1, RY + 10, RZ + z1, WX1, RY + 10, RZ + z2, 'dark_oak_planks')
        for z in range(RZ + z1, RZ + z2, 2):
            window(WX1, z, *UP, 'z', 1, shutters=False)
    window(WX1, RZ + 2, *LOW, 'z', 1)
    window(WX1, RZ + 2, *UP, 'z', 1)
    for x in range(RX + 2, RX + RW - 2, 6):                                 # north: upper row; south: both
        window(x, WZ0, *UP, 'x', -1)
        if not (BAY[0] - 2 <= x <= BAY[1]):
            window(x, WZ1, *LOW, 'x', 1)
            window(x, WZ1, *UP, 'x', 1)

    for x in (WX0, RX + 5, RX + 11, RX + 21, RX + 27, WX1):                  # pillars, +1 out
        fill(x, 1, WZ1 + 1, x, TOP - 1, WZ1 + 1, 'deepslate_bricks')
        fill(x, 1, WZ0 - 1, x, TOP - 1, WZ0 - 1, 'deepslate_bricks')
    for z in (WZ0, RZ + 7, RZ + 13, RZ + 19, WZ1):
        fill(WX0 - 1, 1, z, WX0 - 1, TOP - 1, z, 'deepslate_bricks')
        fill(WX1 + 1, 1, z, WX1 + 1, TOP - 1, z, 'deepslate_bricks')

    # ------------------------------------------------------------ mansard roof with dormers
    def rect(o):
        return WX0 - 1 + o, WZ0 - 1 + o, WX1 + 1 - o, WZ1 + 1 - o

    x0, z0, x1, z1 = rect(0)
    fill(x0, TOP, z0, x1, TOP, z1, 'dark_oak_slab[type=top]')               # soffit under the eave
    fill(WX0, TOP, WZ0, WX1, TOP, WZ1, 'dark_oak_planks')
    for s in range(4):                                                      # steep lower slope: 2 up, 1 in
        y = TOP + 1 + 2 * s
        x0, z0, x1, z1 = rect(s)
        fill(x0, y, z0, x1, y + 1, z1, 'deepslate_tiles')
        fill(x0, y + 1, z0, x1, y + 1, z0, 'deepslate_tile_stairs[facing=south]')
        fill(x0, y + 1, z1, x1, y + 1, z1, 'deepslate_tile_stairs[facing=north]')
        fill(x0, y + 1, z0 + 1, x0, y + 1, z1 - 1, 'deepslate_tile_stairs[facing=east]')
        fill(x1, y + 1, z0 + 1, x1, y + 1, z1 - 1, 'deepslate_tile_stairs[facing=west]')
    ROOF_TOP = TOP + 9
    x0, z0, x1, z1 = rect(4)
    fill(x0, ROOF_TOP, z0, x1, ROOF_TOP, z1, 'deepslate_tile_slab[type=bottom]')
    for z in (z0, z1):                                                      # iron cresting
        fill(x0, ROOF_TOP + 1, z, x1, ROOF_TOP + 1, z, 'iron_bars')
    for x in (x0, x1):
        fill(x, ROOF_TOP + 1, z0, x, ROOF_TOP + 1, z1, 'iron_bars')
    for x, z in ((x0, z0), (x1, z0), (x0, z1), (x1, z1)):
        fill(x, ROOF_TOP, z, x, ROOF_TOP + 1, z, 'polished_blackstone_bricks')
        put(x, ROOF_TOP + 2, z, 'lightning_rod')

    def dormer(a, axis, out_dir):
        """3-wide dormer standing on the eave with a glowing window and its own little gable."""
        if axis == 'x':                                                     # on the north or south slope
            front = WZ1 + 1 if out_dir > 0 else WZ0 - 1
            za, zb = sorted((front, front - 3 * out_dir))
            ea, eb = za - (out_dir < 0), zb + (out_dir > 0)
            fill(a, TOP + 1, za, a + 2, TOP + 4, zb, 'dark_oak_planks')
            fill(a, TOP + 1, front, a, TOP + 4, front, 'stripped_dark_oak_log[axis=y]')
            fill(a + 2, TOP + 1, front, a + 2, TOP + 4, front, 'stripped_dark_oak_log[axis=y]')
            for y in (TOP + 2, TOP + 3):
                put(a + 1, y, front, 'white_stained_glass_pane')
                put(a + 1, y, front - out_dir, 'sea_lantern')
            fill(a, TOP + 5, ea, a + 2, TOP + 5, eb, 'deepslate_tiles')
            fill(a - 1, TOP + 5, ea, a - 1, TOP + 5, eb, 'deepslate_tile_stairs[facing=east]')
            fill(a + 3, TOP + 5, ea, a + 3, TOP + 5, eb, 'deepslate_tile_stairs[facing=west]')
            fill(a, TOP + 6, ea, a, TOP + 6, eb, 'deepslate_tile_stairs[facing=east]')
            fill(a + 2, TOP + 6, ea, a + 2, TOP + 6, eb, 'deepslate_tile_stairs[facing=west]')
            fill(a + 1, TOP + 6, ea, a + 1, TOP + 6, eb, 'deepslate_tile_slab[type=bottom]')
        else:                                                               # on the east or west slope
            front = WX1 + 1 if out_dir > 0 else WX0 - 1
            xa, xb = sorted((front, front - 3 * out_dir))
            ea, eb = xa - (out_dir < 0), xb + (out_dir > 0)
            fill(xa, TOP + 1, a, xb, TOP + 4, a + 2, 'dark_oak_planks')
            fill(front, TOP + 1, a, front, TOP + 4, a, 'stripped_dark_oak_log[axis=y]')
            fill(front, TOP + 1, a + 2, front, TOP + 4, a + 2, 'stripped_dark_oak_log[axis=y]')
            for y in (TOP + 2, TOP + 3):
                put(front, y, a + 1, 'white_stained_glass_pane')
                put(front - out_dir, y, a + 1, 'sea_lantern')
            fill(ea, TOP + 5, a, eb, TOP + 5, a + 2, 'deepslate_tiles')
            fill(ea, TOP + 5, a - 1, eb, TOP + 5, a - 1, 'deepslate_tile_stairs[facing=south]')
            fill(ea, TOP + 5, a + 3, eb, TOP + 5, a + 3, 'deepslate_tile_stairs[facing=north]')
            fill(ea, TOP + 6, a, eb, TOP + 6, a, 'deepslate_tile_stairs[facing=south]')
            fill(ea, TOP + 6, a + 2, eb, TOP + 6, a + 2, 'deepslate_tile_stairs[facing=north]')
            fill(ea, TOP + 6, a + 1, eb, TOP + 6, a + 1, 'deepslate_tile_slab[type=bottom]')

    for x in (RX + 2, RX + 8, RX + 25, RX + 29):
        dormer(x, 'x', 1)
    for x in (RX + 4, RX + 15, RX + 26):
        dormer(x, 'x', -1)
    for z in (RZ + 6, RZ + 18):
        dormer(z, 'z', -1)
        dormer(z, 'z', 1)

    # Chimneys, off-centre and of different heights, with soul-fire smoke.
    for cx, cz, top in ((RX + 6, RZ + 4, ROOF_TOP + 5), (RX + 24, RZ + 21, ROOF_TOP + 3)):
        fill(cx, TOP + 1, cz, cx + 1, top, cz + 1, 'polished_blackstone_bricks')
        fill(cx - 1, top, cz - 1, cx + 2, top, cz + 2, 'polished_blackstone_brick_slab[type=bottom]')
        put(cx, top, cz, 'soul_campfire[lit=true]')
        put(cx + 1, top, cz + 1, 'soul_campfire[lit=true]')

    # ------------------------------------------------------------ front bay, porch and door
    fill(BAY[0] - 1, 1, WZ1, BAY[1] + 1, 1, BAY_Z + 1, 'cobbled_deepslate')
    fill(BAY[0], 2, WZ1, BAY[1], BAY_TOP, BAY_Z, 'stone_bricks')
    scatter([(x, BAY_Z) for x in range(BAY[0], BAY[1] + 1)] + [(BAY[0], z) for z in range(WZ1, BAY_Z)] +
            [(BAY[1], z) for z in range(WZ1, BAY_Z)], 11, BAY_TOP - 1)
    for x in (BAY[0], BAY[1]):
        fill(x, 1, BAY_Z + 1, x, BAY_TOP - 1, BAY_Z + 1, 'deepslate_bricks')
        beam(x, TOP, WZ1, x, BAY_Z)
    beam(BAY[0], TOP, BAY_Z, BAY[1], BAY_Z)
    fill(BAY[0], BAY_TOP, WZ1, BAY[1], BAY_TOP, BAY_Z, 'dark_oak_planks')
    fill(BAY[0] - 1, BAY_TOP, BAY_Z + 1, BAY[1] + 1, BAY_TOP, BAY_Z + 1, 'dark_oak_slab[type=top]')
    # Porch: open, dark oak, under the bay.
    fill(BAY[0] + 1, 2, WZ1, BAY[1] - 1, 2, BAY_Z, 'dark_oak_planks')
    fill(BAY[0] + 1, 3, WZ1, BAY[1] - 1, 9, BAY_Z, 'air')
    fill(BAY[0] + 1, 10, WZ1, BAY[1] - 1, 10, BAY_Z, 'dark_oak_planks')
    beam(BAY[0], 10, BAY_Z, BAY[1], BAY_Z)
    for x in (BAY[0] + 1, BAY[1] - 1):
        for z in (WZ1 + 1, BAY_Z):
            fill(x, 3, z, x, 9, z, 'stripped_dark_oak_log[axis=y]')
        fill(x, 3, WZ1 + 2, x, 3, BAY_Z - 1, 'dark_oak_fence')                 # side railings
    for x in range(BAY[0] + 2, BAY[1] - 1):
        put(x, 9, BAY_Z, 'dark_oak_stairs[half=top,facing=north]')
        if not (DOOR_X - 1 <= x <= DOOR_X + 2):
            put(x, 3, BAY_Z, 'dark_oak_fence')                                 # front railing, gap at the steps
    for x in (DOOR_X - 3, DOOR_X + 4):
        put(x, 9, WZ1 + 3, 'iron_chain[axis=y]')
        put(x, 8, WZ1 + 3, 'soul_lantern[hanging=true]')
    put(BAY[0] + 2, 9, WZ1 + 1, 'cobweb')
    put(BAY[1] - 2, 9, BAY_Z - 1, 'cobweb')
    put(BAY[0] + 2, 3, WZ1 + 1, 'jack_o_lantern[facing=south]')
    put(BAY[1] - 2, 3, WZ1 + 1, 'jack_o_lantern[facing=south]')
    put(BAY[0] + 3, 3, WZ1 + 1, 'potted_dead_bush')
    fill(BAY[0] + 1, 3, WZ1 - 1, BAY[1] - 1, 9, WZ1 - 1, 'stone_bricks')   # porch back wall (room shell is behind panels)
    # Recessed arched doorway (2 wide) leading to the room's double door.
    fill(DOOR_X, 3, WZ1 - 1, DOOR_X + 1, 5, WZ1, 'air')
    fill(DOOR_X - 1, 3, WZ1, DOOR_X - 1, 6, WZ1, 'stripped_dark_oak_log[axis=y]')
    fill(DOOR_X + 2, 3, WZ1, DOOR_X + 2, 6, WZ1, 'stripped_dark_oak_log[axis=y]')
    fill(DOOR_X, 6, WZ1, DOOR_X + 1, 6, WZ1, 'dark_oak_planks')
    put(DOOR_X, 5, WZ1, 'dark_oak_stairs[half=top,facing=east]')
    put(DOOR_X + 1, 5, WZ1, 'dark_oak_stairs[half=top,facing=west]')
    fill(DOOR_X - 1, 7, WZ1 + 1, DOOR_X + 2, 7, WZ1 + 1, 'dark_oak_slab[type=top]')
    # Steps down to the path.
    fill(BAY[0] + 1, 2, BAY_Z + 1, BAY[1] - 1, 2, BAY_Z + 1, 'polished_deepslate_stairs[facing=north]')
    fill(BAY[0] + 1, 1, BAY_Z + 1, BAY[1] - 1, 1, BAY_Z + 1, 'polished_deepslate')
    fill(BAY[0] + 1, 1, BAY_Z + 2, BAY[1] - 1, 1, BAY_Z + 2, 'polished_deepslate_stairs[facing=north]')
    # Bay windows: tall front window over the porch, a pair above, a rose window in the gable.
    for x in range(DOOR_X - 1, DOOR_X + 3):
        for y in range(12, 17):
            put(x, y, BAY_Z, 'white_stained_glass_pane')
            put(x, y, BAY_Z - 1, 'sea_lantern')
        put(x, 11, BAY_Z + 1, 'dark_oak_stairs[half=top,facing=north]')
        put(x, 17, BAY_Z, 'dark_oak_planks')
    fill(DOOR_X - 2, 12, BAY_Z + 1, DOOR_X - 2, 16, BAY_Z + 1, 'dark_oak_trapdoor[open=true,facing=south]')
    fill(DOOR_X + 3, 12, BAY_Z + 1, DOOR_X + 3, 16, BAY_Z + 1, 'dark_oak_trapdoor[open=true,facing=south]')
    for x in (DOOR_X - 2, DOOR_X + 3):
        for y in (19, 20, 21):
            put(x, y, BAY_Z, 'white_stained_glass_pane')
            put(x, y, BAY_Z - 1, 'sea_lantern')
    # Bay gable (ridge along z), rising above the mansard.
    k = 0
    while True:
        y, xa, xb = BAY_TOP + 1 + k, BAY[0] - 1 + k, BAY[1] + 1 - k
        if xa > xb:
            break
        if xa == xb:
            fill(xa, y, WZ1 - 5, xa, y, BAY_Z + 1, 'deepslate_tile_slab[type=bottom]')
            break
        if xb - xa > 1:
            fill(xa + 1, y, WZ1 - 5, xb - 1, y, BAY_Z, 'stone_bricks')
        fill(xa, y, WZ1 - 5, xa, y, BAY_Z + 1, 'deepslate_tile_stairs[facing=east]')
        fill(xb, y, WZ1 - 5, xb, y, BAY_Z + 1, 'deepslate_tile_stairs[facing=west]')
        k += 1
    gc = (BAY[0] + BAY[1]) // 2
    for dx, dy in ((0, 2), (0, 3), (0, 4), (-1, 3), (1, 3)):                # rose window
        put(gc + dx, BAY_TOP + dy, BAY_Z, 'white_stained_glass_pane')
        put(gc + dx, BAY_TOP + dy, BAY_Z - 1, 'sea_lantern')
    fill(gc, BAY_TOP + 8, BAY_Z, gc, BAY_TOP + 10, BAY_Z, 'iron_bars')
    put(gc, BAY_TOP + 11, BAY_Z, 'lightning_rod')

    # ------------------------------------------------------------ towers (different heights) with spires
    for tx0, tw_top in ((WX0 - 8, TOP + 10), (WX1 + 2, TOP + 15)):
        tx1, tz0, tz1 = tx0 + 6, WZ1 - 6, WZ1 + 1
        fill(tx0 - 1, 1, tz0 - 1, tx1 + 1, 1, tz1 + 1, 'cobbled_deepslate')
        fill(tx0, 2, tz0, tx1, tw_top, tz1, 'stone_bricks')
        faces = [(x, z) for x in range(tx0, tx1 + 1) for z in (tz0, tz1)] + [(x, z) for z in range(tz0, tz1 + 1) for x in (tx0, tx1)]
        scatter(faces, 3, tw_top - 1)
        for x, z in ((tx0, tz0), (tx1, tz0), (tx0, tz1), (tx1, tz1)):
            fill(x, 1, z, x, tw_top, z, 'deepslate_bricks')
        fill(tx0 - 1, 2, tz0 - 1, tx1 + 1, 2, tz1 + 1, 'polished_deepslate')
        for y in (11, TOP):
            beam(tx0, y, tz0, tx1, tz0)
            beam(tx0, y, tz1, tx1, tz1)
            beam(tx0, y, tz0, tx0, tz1)
            beam(tx1, y, tz0, tx1, tz1)
        fill(tx0 - 1, tw_top, tz0 - 1, tx1 + 1, tw_top, tz1 + 1, 'dark_oak_slab[type=top]')
        fill(tx0, tw_top, tz0, tx1, tw_top, tz1, 'dark_oak_planks')
        mx, mz = tx0 + 3, tz0 + 3
        outer = -1 if tx0 < WX0 else 1
        ex = tx1 if outer > 0 else tx0
        rows = [(5, 9), (13, 16), (20, 24)] + ([(27, 30)] if tw_top > TOP + 12 else [])
        for y1, y2 in rows:
            for y in range(y1, y2 + 1):
                put(mx, y, tz1, 'white_stained_glass_pane')
                put(mx, y, tz1 - 1, 'sea_lantern')
                put(ex, y, mz, 'white_stained_glass_pane')
                put(ex - outer, y, mz, 'sea_lantern')
            put(mx, y2 + 1, tz1, 'dark_oak_planks')
            put(mx, y1 - 1, tz1 + 1, 'dark_oak_stairs[half=top,facing=north]')
            put(ex, y2 + 1, mz, 'dark_oak_planks')
        y = tw_top + 1
        for s in range(4):                                                  # spire: 2 up per 1 in
            a0, a1, b0, b1 = tx0 + s, tx1 - s, tz0 + s, tz1 - s
            fill(a0, y, b0, a1, y + 1, b1, 'deepslate_tiles')
            if a0 < a1:
                fill(a0, y + 1, b0, a1, y + 1, b0, 'deepslate_tile_stairs[facing=south]')
                fill(a0, y + 1, b1, a1, y + 1, b1, 'deepslate_tile_stairs[facing=north]')
                fill(a0, y + 1, b0 + 1, a0, y + 1, b1 - 1, 'deepslate_tile_stairs[facing=east]')
                fill(a1, y + 1, b0 + 1, a1, y + 1, b1 - 1, 'deepslate_tile_stairs[facing=west]')
            y += 2
        fill(mx, y, mz, mx, y + 2, mz, 'iron_bars')
        put(mx, y + 3, mz, 'lightning_rod')

    # ------------------------------------------------------------ grounds
    px0, px1 = DOOR_X - 2, DOOR_X + 3
    tiles = ('calcite', 'polished_andesite', 'tuff', 'cobblestone', 'smooth_stone', 'polished_andesite')  # no gravel: it falls into the void
    for z in range(BAY_Z + 3, D - 1, 2):
        for x in range(px0, px1 + 1, 2):
            fill(x, 0, z, min(px1, x + 1), 0, min(D - 2, z + 1), rnd.choice(tiles))
    for z in range(BAY_Z + 6, D - 3, 5):                                     # lamp posts
        for x in (px0 - 1, px1 + 1):
            fill(x, 1, z, x, 3, z, 'dark_oak_fence')
            put(x, 4, z, 'soul_lantern')
    for gx0, gx1 in ((4, px0 - 4), (px1 + 4, W - 5)):                        # graveyard
        for z in range(BAY_Z + 5, D - 4, 3):
            for x in range(gx0, gx1 + 1, 3):
                if rnd.random() < 0.8:
                    put(x, 1, z, rnd.choice(('stone_brick_wall', 'mossy_stone_brick_wall', 'cobbled_deepslate_wall', 'andesite_wall')))
                    if rnd.random() < 0.4:
                        put(x, 2, z, 'stone_button[face=floor]')
        for _ in range(60):
            x, z = rnd.randint(gx0 - 1, gx1 + 1), rnd.randint(BAY_Z + 4, D - 4)
            put(x, 1, z, rnd.choice(('dead_bush', 'wither_rose', 'dead_bush', 'fern')))
    for tx, tz, h in ((5, WZ1 + 9, 8), (W - 6, WZ1 + 9, 9), (4, D - 6, 7), (W - 5, D - 7, 8), (5, 2, 9), (W - 6, 3, 8),
                      (3, RZ + 14, 7), (W - 4, RZ + 13, 8)):                 # red trees
        for dx in range(-3, 4):
            for dz in range(-3, 4):
                for dy in range(-1, 3):
                    if dx * dx + dz * dz + dy * dy * 2 <= 10 and rnd.random() < 0.8:
                        x, z = tx + dx, tz + dz
                        if 0 <= x < W and 0 <= z < D:
                            put(x, h + dy, z, 'nether_wart_block')
        fill(tx, 1, tz, tx, h, tz, 'dark_oak_log[axis=y]')
    for x in range(1, W - 1):                                                # iron fence, gate gap at the path
        if not (px0 <= x <= px1):
            fill(x, 1, D - 2, x, 2, D - 2, 'iron_bars')
        fill(x, 1, 1, x, 2, 1, 'iron_bars')
    for z in range(1, D - 1):
        fill(1, 1, z, 1, 2, z, 'iron_bars')
        fill(W - 2, 1, z, W - 2, 2, z, 'iron_bars')
    posts = [(x, 1) for x in range(1, W - 1, 5)] + [(x, D - 2) for x in range(1, W - 1, 5)] + \
            [(1, z) for z in range(1, D - 1, 5)] + [(W - 2, z) for z in range(1, D - 1, 5)]
    for x, z in posts:
        if px0 - 1 <= x <= px1 + 1 and z == D - 2:
            continue
        fill(x, 1, z, x, 3, z, 'polished_blackstone_bricks')
        put(x, 4, z, 'soul_lantern')
    for x in (px0 - 1, px1 + 1):                                             # gate posts
        fill(x, 1, D - 2, x, 4, D - 2, 'polished_blackstone_bricks')
        put(x, 5, D - 2, 'skeleton_skull[rotation=0]')
    fill(px0 - 1, 6, D - 2, px1 + 1, 6, D - 2, 'iron_bars')                  # arch over the gate
    put(DOOR_X, 1, D - 4, 'structure_block[mode=data]{mode:"DATA",metadata:"spawn"}')  # at the gate, facing the house
    put(DOOR_X + 2, 1, D - 8, 'structure_block[mode=data]{mode:"DATA",metadata:"guide"}')  # Boo, the tour ghost, on the path
    print('\n'.join(out))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit('usage: build_mansion.py X Y Z')
    main(*(int(a) for a in sys.argv[1:]))
