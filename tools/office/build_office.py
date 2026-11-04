#!/usr/bin/env python3
"""Generates the Haunted Office as Minecraft commands (one per line) relative to an origin.

Usage: python3 tools/office/build_office.py X Y Z > office.mcfunction
Then run the lines on a server (RCON) and save with: /crew office save X Y Z X+32 Y+12 Z+26

Layout (x 0..32, y 0..12, z 0..26; north = z 0 = screen wall):
- 15x7 screen on the north wall, two tiers of 4 desks facing it (mission control), centre aisle.
- West wall: bookshelf bays. East wall: recessed purple windows and the task board.
- Stripped dark oak pillars and ceiling beams, lantern chandeliers, glowing desk monitors, candles.
Markers (structure blocks, DATA mode): desk x8, screen, taskwall, bell, spawn.
"""
import sys

W, H, D = 33, 13, 27
DESK_X = (6, 11, 21, 26)
BANNER = ('purple_wall_banner[facing={facing}]{{patterns:[{{color:"orange",pattern:"minecraft:rhombus"}},'
          '{{color:"purple",pattern:"minecraft:circle"}},{{color:"black",pattern:"minecraft:border"}}]}}')
FRONT_Z, BACK_Z = 10, 16


def main(ox, oy, oz):
    out = []

    def fill(x1, y1, z1, x2, y2, z2, block):
        out.append(f'fill {ox + x1} {oy + y1} {oz + z1} {ox + x2} {oy + y2} {oz + z2} {block}')

    def put(x, y, z, block):
        out.append(f'setblock {ox + x} {oy + y} {oz + z} {block}')

    def marker(x, y, z, name):
        put(x, y, z, f'structure_block[mode=data]{{mode:"DATA",metadata:"{name}"}}')

    # Shell, floor, ceiling.
    fill(0, 0, 0, W - 1, H - 1, D - 1, 'deepslate_tiles')
    fill(1, 1, 1, W - 2, H - 2, D - 2, 'air')
    fill(1, 0, 1, W - 2, 0, D - 2, 'polished_deepslate')
    fill(2, 0, 2, W - 3, 0, D - 3, 'dark_oak_planks')
    fill(1, H - 1, 1, W - 2, H - 1, D - 2, 'dark_oak_planks')

    # Wainscot + trim line on every wall face (depth: panels behind pillars).
    for x1, z1, x2, z2 in ((1, 1, 1, D - 2), (W - 2, 1, W - 2, D - 2), (1, 1, W - 2, 1), (1, D - 2, W - 2, D - 2)):
        fill(x1, 1, z1, x2, 3, z2, 'dark_oak_planks')
        fill(x1, 4, z1, x2, 4, z2, 'polished_deepslate')
        fill(x1, 10, z1, x2, 11, z2, 'dark_oak_planks')
    fill(1, 1, 2, W - 2, 3, D - 3, 'air')  # keep only the wall faces

    # West wall: bookshelf bays between pillars.
    fill(1, 5, 2, 1, 9, D - 3, 'bookshelf')
    # East wall: recessed windows (glass in the outer wall, air in the inner face).
    for z1, z2 in ((8, 11), (14, 18), (20, 23)):
        fill(W - 2, 5, z1, W - 2, 9, z2, 'air')
        fill(W - 1, 5, z1, W - 1, 9, z2, 'glass')
        fill(W - 2, 4, z1, W - 2, 4, z2, 'polished_deepslate_slab[type=top]')
    # East wall: task board near the screen.
    fill(W - 2, 5, 2, W - 2, 9, 6, 'stripped_spruce_wood')
    fill(W - 2, 6, 3, W - 2, 8, 5, 'birch_planks')
    marker(W - 3, 7, 4, 'taskwall')
    # South wall: bookshelves either side of the door.
    fill(2, 5, D - 2, 13, 9, D - 2, 'bookshelf')
    fill(19, 5, D - 2, W - 3, 9, D - 2, 'bookshelf')

    # Pillars on the side walls and the south wall.
    for z in (1, 7, 13, 19, D - 2):
        fill(1, 1, z, 1, 11, z, 'stripped_dark_oak_log')
        fill(W - 2, 1, z, W - 2, 11, z, 'stripped_dark_oak_log')
        put(2, 1, z if z not in (1, D - 2) else (2 if z == 1 else D - 3), 'jack_o_lantern[facing=east]')
    for x in (7, 13, 19, 25):
        fill(x, 1, D - 2, x, 11, D - 2, 'stripped_dark_oak_log')

    # Ceiling beams (grid) and soul-lantern chandeliers at the crossings.
    for z in (7, 13, 19):
        fill(1, 11, z, W - 2, 11, z, 'stripped_dark_oak_log[axis=x]')
    for x in (8, 16, 24):
        fill(x, 11, 1, x, 11, D - 2, 'stripped_dark_oak_log[axis=z]')
    for x in (8, 16, 24):
        for z in (7, 13, 19):
            put(x, 10, z, 'iron_chain[axis=y]')
            put(x, 9, z, 'lantern[hanging=true]' if x == 16 else 'soul_lantern[hanging=true]')
    for x, z in ((2, 2), (W - 3, 2), (2, D - 3), (W - 3, D - 3)):
        put(x, 11, z, 'cobweb')
    # Fill light so the room reads clearly (invisible light blocks, full brightness).
    for x in (4, 10, 16, 22, 28):
        for z in (4, 9, 14, 19, 23):
            put(x, 7, z, 'light[level=15]')

    # Big screen on the north wall, framed.
    fill(8, 2, 1, 24, 10, 1, 'polished_blackstone')
    fill(9, 3, 1, 23, 9, 1, 'black_concrete')
    marker(16, 6, 2, 'screen')
    put(7, 3, 1, 'lantern')
    put(25, 3, 1, 'lantern')

    # Centre aisle runner.
    fill(15, 1, 3, 17, 1, D - 3, 'purple_carpet')

    # Back tier: two raised wings with steps.
    for x1, x2 in ((3, 13), (19, 29)):
        fill(x1, 1, BACK_Z - 2, x2, 1, BACK_Z + 2, 'dark_oak_planks')
        fill(x1, 1, BACK_Z - 3, x2, 1, BACK_Z - 3, 'polished_deepslate_stairs[facing=north]')

    # Desks: slab top, monitor, candle, chair (stairs), marker above the chair.
    for z, y in ((FRONT_Z, 1), (BACK_Z, 2)):
        for cx in DESK_X:
            fill(cx - 1, y, z, cx + 1, y, z, 'spruce_planks')
            put(cx - 1, y, z - 1, 'spruce_trapdoor[facing=north,half=top,open=true]')
            put(cx + 1, y, z - 1, 'spruce_trapdoor[facing=north,half=top,open=true]')
            put(cx, y + 1, z, 'hauntedcrew:monitor[facing=south]')
            put(cx + 1, y + 1, z, 'white_candle[lit=true,candles=3]')
            put(cx - 1, y + 1, z, ('potted_dead_bush', 'purple_candle[lit=true,candles=4]', 'potted_crimson_fungus', 'white_candle[lit=true,candles=2]')[(cx + z) % 4])
            put(cx, y, z + 1, 'dark_oak_stairs[facing=south]')
            marker(cx, y + 1, z + 1, 'desk')

    # Entrance: door, bell, steering lectern, pumpkins, spawn.
    for x, hinge in ((16, 'left'), (17, 'right')):                  # double front door
        fill(x, 1, D - 1, x, 2, D - 1, 'air')
        put(x, 1, D - 2, f'dark_oak_door[half=lower,facing=north,hinge={hinge}]')
        put(x, 2, D - 2, f'dark_oak_door[half=upper,facing=north,hinge={hinge}]')
    for x in (14, 19):
        put(x, 1, D - 3, 'polished_deepslate_wall')
        put(x, 2, D - 3, 'soul_lantern')
    put(27, 1, 23, 'dark_oak_fence')
    put(27, 2, 23, 'bell[attachment=floor,facing=east]')
    marker(28, 1, 23, 'bell')
    put(11, 1, 21, 'lectern[facing=south,has_book=true]')
    for x, z in ((3, 24), (29, 24), (29, 3), (3, 3)):
        put(x, 1, z, 'carved_pumpkin[facing=south]')
    marker(16, 1, 21, 'spawn')


    # ------------------------------------------------------------ atmosphere (warm candles, purple, cobwebs)
    STONE = ('stone_bricks', 'stone_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks', 'tuff_bricks')
    for x in range(2, W - 2):                                   # stone upper wall on the north side
        for y in range(5, 10):
            if not (8 <= x <= 24 and 2 <= y <= 10):
                put(x, y, 0, STONE[(x * 7 + y * 3) % len(STONE)])
    for x in (4, 28):                                           # banners beside the screen
        put(x, 9, 1, BANNER.format(facing='south'))
        put(x, 8, 0, 'stone_bricks')
        put(x, 9, 0, 'stone_bricks')
    for z in (7, 13, 19):                                       # banners on the pillars
        put(2, 9, z, BANNER.format(facing='east'))
        put(W - 3, 9, z, BANNER.format(facing='west'))
    for x in (7, 25):
        put(x, 9, D - 3, BANNER.format(facing='north'))
    # Candle ledge along the bookshelves.
    fill(2, 4, 2, 2, 4, D - 3, 'spruce_slab[type=top]')
    for z in range(2, D - 2):
        if z % 3 == 0:
            put(2, 5, z, ('white_candle[lit=true,candles=3]', 'candle[lit=true,candles=2]', 'purple_candle[lit=true,candles=1]')[(z // 3) % 3])
    # Planner notice board on the west wall.
    fill(1, 5, 9, 1, 9, 12, 'stripped_spruce_wood')
    fill(1, 6, 10, 1, 8, 11, 'dark_oak_planks')
    for y, z in ((6, 10), (8, 11), (7, 10), (6, 11), (8, 10)):  # pinned notes
        put(2, y, z, 'birch_button[face=wall,facing=east]')
    # Cobwebs in the upper corners and along the beams near the walls.
    for x, z in ((2, 3), (3, 2), (W - 3, 3), (W - 4, 2), (2, D - 4), (W - 3, D - 4), (2, 8), (2, 14), (2, 20),
                 (W - 3, 8), (W - 3, 14), (W - 3, 20), (7, 2), (25, 2)):
        put(x, 10, z, 'cobweb')
    for z1, z2 in ((8, 11), (14, 18), (20, 23)):                # webs in the window corners
        put(W - 2, 9, z1, 'cobweb')
    # Purple rugs ("fog") around the desks and pumpkins on pedestals.
    for x1, x2 in ((3, 13), (19, 29)):
        fill(x1, 1, FRONT_Z - 2, x2, 1, FRONT_Z - 1, 'purple_carpet')
        fill(x1, 1, FRONT_Z + 2, x2, 1, FRONT_Z + 2, 'magenta_carpet')
    for x, z in ((3, 6), (29, 6), (29, 20)):
        put(x, 1, z, 'stripped_spruce_wood')
        put(x, 2, z, 'jack_o_lantern[facing=south]')
        put(x, 3, z, 'white_candle[lit=true,candles=4]')
    for x, z in ((6, 2), (26, 2), (2, 24), (30, 24)):
        put(x, 1, z, 'white_candle[lit=true,candles=4]')

    # ------------------------------------------------------------ polish: focal points and warm light
    # Stage rug in front of the screen (black with a purple border); the aisle runner crosses it.
    fill(9, 1, 3, 23, 1, 7, 'purple_carpet')
    fill(10, 1, 4, 22, 1, 6, 'black_carpet')
    fill(15, 1, 3, 17, 1, 7, 'purple_carpet')
    # Candle chandeliers over the aisle (chain, a cross of fence arms, candles on the arms).
    for z in (7, 13, 19):
        put(16, 9, z, 'iron_chain[axis=y]')
        for dx, dz in ((0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)):
            put(16 + dx, 8, z + dz, 'dark_oak_fence')
        for dx, dz in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            put(16 + dx, 9, z + dz, 'white_candle[lit=true,candles=3]' if dx else 'purple_candle[lit=true,candles=2]')
    # Fireplace with soul fire on the west wall (back corner, clear of the desks).
    fill(1, 1, 20, 1, 4, 24, 'polished_blackstone_bricks')
    fill(1, 1, 21, 1, 2, 23, 'air')
    fill(0, 1, 21, 0, 3, 23, 'polished_blackstone_bricks')
    put(1, 0, 22, 'soul_soil')
    put(1, 1, 22, 'soul_fire')
    put(1, 1, 21, 'iron_bars')
    put(1, 1, 23, 'iron_bars')
    fill(2, 0, 20, 3, 0, 24, 'polished_blackstone_bricks')            # hearth
    fill(2, 4, 19, 2, 4, 25, 'polished_blackstone_brick_slab[type=top]')  # mantel
    put(2, 5, 22, 'wither_skeleton_skull[rotation=4]')
    put(2, 5, 20, 'purple_candle[lit=true,candles=3]')
    put(2, 5, 24, 'white_candle[lit=true,candles=3]')
    put(2, 5, 21, 'potted_wither_rose')
    put(2, 5, 23, 'potted_dead_bush')
    fill(4, 1, 21, 6, 1, 23, 'red_carpet')
    for z in (21, 23):                                                # armchairs facing the fire
        put(5, 1, z, 'dark_oak_stairs[facing=east]')
    # Witch's cauldron bubbling over soul fire near the entrance.
    put(24, 1, 22, 'soul_campfire[lit=true]')
    put(24, 2, 22, 'water_cauldron[level=3]')
    for x, z in ((23, 21), (25, 23), (25, 21)):
        put(x, 1, z, 'purple_candle[lit=true,candles=3]')
    put(23, 1, 23, 'brewing_stand')
    # Amethyst glints in the corners and by the pillars.
    for x, z in ((2, 2), (W - 3, 2), (2, 7), (W - 3, 7), (2, 18), (W - 3, 13), (W - 3, 19), (W - 3, D - 3)):
        put(x, 1, z, 'amethyst_cluster[facing=up]')
    # Potted plants and stacked books on the east windowsills.
    for z1, z2 in ((8, 11), (14, 18), (20, 23)):
        put(W - 2, 5, z1, 'potted_crimson_roots')
        put(W - 2, 5, z2, 'white_candle[lit=true,candles=2]')

    print('\n'.join(out))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit('usage: build_office.py X Y Z')
    main(*(int(a) for a in sys.argv[1:]))
