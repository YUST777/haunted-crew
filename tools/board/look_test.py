# One-frame look test for the "ghosts possess the workflow" board (landing page Workflows section).
# Final state of the intro: each job ghost has entered its block, redstone carries the signal
# Start -> Planner -> Coder (Coder is working), and the Reviewer ghost is still diving in.
#
# blender -b -P tools/board/look_test.py -- [--out board.png] [--blend board.blend] [--norender]
#   [--mc DIR]  folder with assets/minecraft/textures (default: blender_insta/shared/mc_client)
# 1 Blender unit = 1 block. Do not render on the dev PC (MX450): use the home server or Colab.
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


MC = arg('--mc', os.path.expanduser('~/Desktop/blender_insta/shared/mc_client'))
TEX = os.path.join(MC, 'assets', 'minecraft', 'textures')
OUT = os.path.abspath(arg('--out', os.path.join(HERE, 'board_look.png')))
GHOST_BLEND = os.path.join(ROOT, 'tools', 'ghost', 'ghost.blend')

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------------ materials


def image(rel):
    path = os.path.join(TEX, rel)
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return bpy.data.images.load(path, check_existing=True)


def pixel_mat(name, rel, tint=None, emit=0.0, emit_color=None, alpha=False, rough=0.9):
    """Minecraft texture, nearest-neighbour. tint multiplies grayscale textures (redstone)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image(rel)
    tex.interpolation = 'Closest'
    color = tex.outputs['Color']
    if tint:
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['B'].default_value = (*tint, 1)
        nt.links.new(color, mix.inputs['A'])
        color = mix.outputs['Result']
    nt.links.new(color, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    if emit:
        nt.links.new(color, bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emit
    if alpha:
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        if hasattr(m, 'blend_method'):
            m.blend_method = 'CLIP'
    return m


def flat_mat(name, rgb, emit=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = 0.6
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*rgb, 1)
        bsdf.inputs['Emission Strength'].default_value = emit
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'BLENDED'
    return m


# ------------------------------------------------------------------ geometry helpers


def box(name, loc, size, mats):
    """Axis-aligned box. mats: one material, or dict with keys top/bottom/front/back/left/right."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if not isinstance(mats, dict):
        o.data.materials.append(mats)
        return o
    order = ['top', 'bottom', 'front', 'back', 'left', 'right']
    for k in order:
        o.data.materials.append(mats.get(k, mats.get('side')))
    for p in o.data.polygons:
        n = p.normal
        p.material_index = (0 if n.z > .5 else 1 if n.z < -.5 else 2 if n.y < -.5 else 3 if n.y > .5
                            else 4 if n.x < -.5 else 5)
    # One texture per face: unit UVs, upright on the side faces.
    uv = o.data.uv_layers.new()
    for p in o.data.polygons:
        vs = [o.data.vertices[i].co for i in p.vertices]
        n = p.normal
        for li, vi in zip(p.loop_indices, p.vertices):
            c = o.data.vertices[vi].co
            if abs(n.z) > .5:
                u, v = c.x, c.y
            elif abs(n.y) > .5:
                u, v = (c.x if n.y < 0 else -c.x), c.z
            else:
                u, v = (-c.y if n.x < 0 else c.y), c.z
            uv.data[li].uv = (u, v)
        # normalise to 0..1 for this face
        us = [uv.data[li].uv[0] for li in p.loop_indices]
        vs2 = [uv.data[li].uv[1] for li in p.loop_indices]
        for li in p.loop_indices:
            a, b = uv.data[li].uv
            uv.data[li].uv = ((a - min(us)) / (max(us) - min(us) or 1), (b - min(vs2)) / (max(vs2) - min(vs2) or 1))
    return o


def tiled_plane(name, loc, size, rot, mat, tiles):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[1], 1)
    bpy.ops.object.transform_apply(scale=True)
    for d in o.data.uv_layers[0].data:
        d.uv = (d.uv[0] * tiles[0], d.uv[1] * tiles[1])
    o.data.materials.append(mat)
    return o


# ------------------------------------------------------------------ set: floor, back wall, frame

floor = pixel_mat('floor', 'block/cobbled_deepslate.png')
wall = pixel_mat('wall', 'block/deepslate_bricks.png')
planks = pixel_mat('planks', 'block/oak_planks.png')
tiled_plane('Floor', (0, 0, 0), (22, 12), (0, 0, 0), floor, (22, 12))
tiled_plane('Wall', (0, 6, 5), (22, 10), (math.pi / 2, 0, 0), wall, (22, 10))
# oak plank shelf edge along the wall foot, like a framed board
for i in range(-11, 11):
    box('Trim', (i + .5, 5.5, .5), (1, 1, 1), planks)

# ------------------------------------------------------------------ the job blocks

STEPS = [  # name, x, z-offset, block faces (side textures), possessed, powered input
    ('start', -8, {'top': 'block/cobblestone.png', 'side': 'block/cobblestone.png'}),
    ('planner', -4, {'top': 'block/cartography_table_top.png', 'side': 'block/cartography_table_side3.png',
                     'front': 'block/cartography_table_side1.png'}),
    ('coder', 0, {'top': 'block/crafting_table_top.png', 'side': 'block/crafting_table_side.png',
                  'front': 'block/crafting_table_front.png'}),
    ('tester', 4, {'top': 'block/target_top.png', 'side': 'block/target_side.png'}),
    ('reviewer', 8, {'top': 'block/lectern_top.png', 'side': 'block/lectern_sides.png',
                     'front': 'block/lectern_front.png'}),
]
cache = {}


def tex_mat(rel):
    if rel not in cache:
        cache[rel] = pixel_mat(os.path.basename(rel)[:-4], rel)
    return cache[rel]


GHOST_WHITE = (0.93, 0.94, 1.0)
EYE = (0.05, 0.06, 0.12)
aura = flat_mat('aura', (0.55, 0.85, 1.0), emit=0.6, alpha=0.07)
eye_mat = flat_mat('eye', EYE)
eye_glow = flat_mat('eye_glow', (0.45, 0.95, 1.0), emit=6.0)
blocks = {}
for name, x, faces in STEPS:
    mats = {k: tex_mat(v) for k, v in faces.items()}
    b = box(f'block_{name}', (x, 0, .5), (1, 1, 1), mats)
    blocks[name] = b
    if name == 'reviewer':
        continue  # its ghost is still diving in
    # possessed: a faint ghost shell around the block and two eyes on the front face
    box(f'aura_{name}', (x, 0, .52), (1.12, 1.12, 1.12), aura)
    glow = eye_glow if name == 'coder' else eye_mat  # the working ghost's eyes light up
    for dx in (-.18, .18):
        box(f'eye_{name}', (x + dx, -.505, .62), (.12, .02, .2), glow)

# lever on the start block (flipped on)
lever_base = pixel_mat('lever_base', 'block/cobblestone.png')
box('lever_base', (-8, 0, 1.03), (.25, .38, .06), lever_base)
lever = box('lever', (-8, 0.06, 1.2), (.07, .07, .4), pixel_mat('lever_stick', 'block/lever.png'))
lever.rotation_euler = (math.radians(-35), 0, 0)

# ------------------------------------------------------------------ redstone dust between blocks

ON = (0.99, 0.12, 0.02)  # vanilla dust colour at power 15
OFF = (0.30, 0.0, 0.0)  # power 0
dust_on = pixel_mat('dust_on', 'block/redstone_dust_line0.png', tint=ON, emit=3.5, alpha=True)
dust_off = pixel_mat('dust_off', 'block/redstone_dust_line0.png', tint=OFF, alpha=True)
xs = [x for _, x, _ in STEPS]
for i in range(len(xs) - 1):
    powered = i < 2  # start -> planner -> coder carry the signal
    for x in range(xs[i] + 1, xs[i + 1]):
        p = tiled_plane(f'dust_{x}', (x, 0, .01), (1, 1), (0, 0, math.pi / 2), dust_on if powered else dust_off, (1, 1))
    if powered:
        bpy.ops.object.light_add(type='POINT', location=((xs[i] + xs[i + 1]) / 2, 0, .3))
        bpy.context.object.data.color = ON
        bpy.context.object.data.energy = 25

# ------------------------------------------------------------------ the diving reviewer ghost

with bpy.data.libraries.load(GHOST_BLEND) as (src, dst):
    dst.objects = [n for n in src.objects if n.startswith('preview_reviewer_')]
ghost_parts = [o for o in dst.objects if o]
ghost = bpy.data.objects.new('ghost_reviewer', None)
scene.collection.objects.link(ghost)
for o in ghost_parts:
    scene.collection.objects.link(o)
    if o.parent is None:
        o.parent = ghost
# centre the model on its own bounding box, then size it: 1/32 block per unit -> 1.4 blocks tall-ish
bpy.context.view_layer.update()
pts = [o.matrix_world @ v.co for o in ghost_parts if o.type == 'MESH' for v in o.data.vertices]
cx = sum(p.x for p in pts) / len(pts)
cy = sum(p.y for p in pts) / len(pts)
minz = min(p.z for p in pts)
for o in ghost_parts:
    if o.parent is ghost:
        o.location.x -= cx
        o.location.y -= cy
        o.location.z -= minz
# face: two eyes on the body front (in the mod the face is painted on; here it is geometry).
# Ghost is still at identity, so world coords = model units.
bpy.context.view_layer.update()
body = next(o for o in ghost_parts if o.name.endswith('_body'))
bv = [body.matrix_world @ v.co for v in body.data.vertices]
front_y = min(p.y for p in bv)
mid_x = (min(p.x for p in bv) + max(p.x for p in bv)) / 2
eye_z = min(p.z for p in bv) + (max(p.z for p in bv) - min(p.z for p in bv)) * .55
for dx in (-3.5, 3.5):
    e = box('ghost_eye', (mid_x + dx, front_y - .2, eye_z), (2.2, .4, 4), eye_mat)
    e.parent = ghost
s = 1 / 18
ghost.scale = (s, s, s)
ghost.location = (7.2, -0.8, 1.35)  # half inside the lectern, nose first
ghost.rotation_euler = (math.radians(30), math.radians(-38), math.radians(-12))

# soul particles where it enters
soul = pixel_mat('soul', 'particle/soul_3.png', emit=4, alpha=True)
for i, (dx, dz) in enumerate([(-.5, .4), (-.2, .9), (.3, .7), (-.7, 1.1), (.1, 1.3), (-.4, .2)]):
    q = tiled_plane(f'soul_{i}', (8 + dx, -.7, 1 + dz), (.28, .28), (math.pi / 2, 0, 0), soul, (1, 1))

# ------------------------------------------------------------------ light, camera, render

bpy.ops.object.light_add(type='AREA', location=(-3, -7, 8))
key = bpy.context.object
key.data.energy = 900
key.data.size = 8
key.data.color = (0.62, 0.72, 1.0)  # moonlit
key.rotation_euler = (math.radians(50), 0, math.radians(-20))
for x in (-9.5, 9.5):  # soul lanterns on the wall
    bpy.ops.object.light_add(type='POINT', location=(x, 5.2, 3.2))
    bpy.context.object.data.color = (0.35, 0.85, 1.0)
    bpy.context.object.data.energy = 120

world = bpy.data.worlds.new('night')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.01, 0.015, 0.03, 1)
scene.world = world

bpy.ops.object.camera_add(location=(0, -15.5, 7.2), rotation=(math.radians(66), 0, 0))
scene.camera = bpy.context.object
scene.camera.data.lens = 30

if '--cycles' in argv:  # fallback when EEVEE has no GPU context (headless cloud boxes)
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            break
        except TypeError:
            pass
    scene.cycles.device = 'GPU'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
else:
    for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            pass
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.eevee.taa_render_samples = 32
try:
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
except TypeError:
    pass
if hasattr(scene.eevee, 'use_bloom'):
    scene.eevee.use_bloom = True
scene.render.filepath = OUT

if arg('--blend'):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(arg('--blend')))
if '--norender' not in argv:
    bpy.ops.render.render(write_still=True)
    print('WROTE', OUT)
print('BUILT', len(bpy.data.objects), 'objects')
