# Builds the two animated voxel ghosts for the landing-page hero and exports them as GLB.
#
# Run inside Blender through MCP for Blender:  python3 tools/hero/bmcp.py tools/hero/build_hero_ghosts.py
# or headless:                                 blender -b --python tools/hero/build_hero_ghosts.py
#
# Shapes are smooth signed-distance functions (rounded head, tapering body, curling tail) that get
# sampled on a voxel grid, so the ghosts read as Minecraft-style pixels with a soft silhouette.
# Grid: 1 voxel = V Blender units, Z up, ghosts face -Y (towards the camera; glTF +Z).
import bpy
import math
import os

try:
    ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
except NameError:
    ROOT = '/home/yousefmsm1/Desktop/kiroween'
ASSETS = os.path.join(ROOT, 'landing_page', 'site', 'public', 'assets')
HERE = os.path.join(ROOT, 'tools', 'hero')
V = 0.06
FRAMES = 120  # 4 s loop at 30 fps
BUILD = globals().get('BUILD', ('miner', 'wizard'))
EXPORT = globals().get('EXPORT', True)

PALETTE = {  # name: (hex, emission strength, roughness)
    'g1': ('F5F3FF', 0.0, 0.8), 'g2': ('E6E1FB', 0.0, 0.8), 'g3': ('D3C9F5', 0.0, 0.8),
    'g4': ('BBAAEE', 0.0, 0.8), 'w1': ('A8E6F2', 0.6, 0.6), 'w2': ('62F0DA', 1.6, 0.5),
    'eye': ('07080F', 0.0, 0.35), 'pupil': ('2FFFE0', 2.2, 0.3),
    'hood': ('1D2547', 0.0, 0.9), 'hood2': ('252E57', 0.0, 0.9), 'hood3': ('151B36', 0.0, 0.9),
    'trim': ('1FCFA6', 1.2, 0.6), 'cord': ('2C3046', 0.0, 0.9),
    'wood': ('8A5A2E', 0.0, 0.9), 'wood2': ('5A3818', 0.0, 0.9),
    'dia': ('2FE3C9', 0.8, 0.4), 'dia_light': ('A6FFF1', 1.5, 0.4), 'dia_dark': ('0E6A62', 0.0, 0.5),
    'hat': ('2C2452', 0.0, 0.85), 'hat2': ('372D66', 0.0, 0.85), 'hat3': ('1E1940', 0.0, 0.85),
    'band': ('2FD27A', 1.0, 0.6), 'gold': ('F2C14E', 1.2, 0.4), 'frame': ('0B0C14', 0.0, 0.3),
    'paper': ('EBD6A6', 0.0, 0.9), 'paper2': ('D9C08A', 0.0, 0.9), 'ink': ('5A4426', 0.0, 0.9),
    'roll': ('9C7444', 0.0, 0.9), 'roll2': ('6E4E2B', 0.0, 0.9),
}

# ---------------------------------------------------------------- math / sdf helpers


def clamp(v, a, b):
    return a if v < a else b if v > b else v


def length(x, y, z):
    return math.sqrt(x * x + y * y + z * z)


def sd_round_box(p, c, b, r):
    qx = abs(p[0] - c[0]) - b[0] + r
    qy = abs(p[1] - c[1]) - b[1] + r
    qz = abs(p[2] - c[2]) - b[2] + r
    return length(max(qx, 0), max(qy, 0), max(qz, 0)) + min(max(qx, qy, qz), 0) - r


def sd_cap(p, a, b, ra, rb):
    """Capsule from a (radius ra) to b (radius rb)."""
    pa = [p[i] - a[i] for i in range(3)]
    ba = [b[i] - a[i] for i in range(3)]
    h = clamp(sum(pa[i] * ba[i] for i in range(3)) / sum(v * v for v in ba), 0, 1)
    return length(*[pa[i] - ba[i] * h for i in range(3)]) - (ra + (rb - ra) * h)


def sd_chain(p, pts):
    return min(sd_cap(p, pts[i][0], pts[i + 1][0], pts[i][1], pts[i + 1][1]) for i in range(len(pts) - 1))


def smin(a, b, k):
    h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def noise(x, y, z, s=0):
    return (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (s * 2654435761)) & 0xFFFF) / 65535.0


def voxelize(fn, xr, yr, zr):
    """fn(center, ijk) -> material name or None, for every voxel in the integer ranges."""
    vox = {}
    for x in range(*xr):
        for y in range(*yr):
            for z in range(*zr):
                m = fn((x + 0.5, y + 0.5, z + 0.5), (x, y, z))
                if m:
                    vox[(x, y, z)] = m
    return vox


# ---------------------------------------------------------------- blender helpers

FACES = {
    (1, 0, 0): [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
    (-1, 0, 0): [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)],
    (0, 1, 0): [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
    (0, -1, 0): [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
    (0, 0, 1): [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
    (0, 0, -1): [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)],
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name):
    m = bpy.data.materials.get('hc_' + name)
    if m:
        return m
    hexc, emit, rough = PALETTE[name]
    rgb = [srgb_to_linear(int(hexc[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    m = bpy.data.materials.new('hc_' + name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    m.diffuse_color = (*rgb, 1)
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = rough
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*rgb, 1)
        bsdf.inputs['Emission Strength'].default_value = emit
    return m


def voxel_object(name, vox, pivot, parent=None, size=V, loc=None):
    """Mesh with only the faces between a voxel and empty space. pivot (grid) becomes the origin."""
    mats = sorted(set(vox.values()))
    verts, index, faces, face_mats = [], {}, [], []
    for (x, y, z), mname in vox.items():
        for n, quad in FACES.items():
            if (x + n[0], y + n[1], z + n[2]) in vox:
                continue
            ids = []
            for c in quad:
                key = tuple(round((v + c[i] - pivot[i]) * size, 5) for i, v in enumerate((x, y, z)))
                if key not in index:
                    index[key] = len(verts)
                    verts.append(key)
                ids.append(index[key])
            faces.append(ids)
            face_mats.append(mats.index(mname))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    for m in mats:
        mesh.materials.append(material(m))
    for poly, mi in zip(mesh.polygons, face_mats):
        poly.material_index = mi
        poly.use_smooth = False
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    if loc is not None:
        obj.location = loc
    return obj


def empty(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.3
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e


def rel(a, b):
    return tuple((a[i] - b[i]) * V for i in range(3))


# ---------------------------------------------------------------- ghost body

HEAD_C, HEAD_B, HEAD_R = (0, 0, 25), (8.5, 7.5, 7.5), 4.5
BODY_PIVOT = (0, 0, 18)
TAIL_PIVOT = (0, 0, 11)
EYES = [(-6, -4), (3, 5)]  # x ranges (inclusive) of the two eyes
EYE_Z = (19, 26)


def sd_head(p):
    return sd_round_box(p, HEAD_C, HEAD_B, HEAD_R)


def tail_points(m):
    return [((0, 0.5, 13), 7.6), ((1.0 * m, 1, 6), 5.6), ((3.5 * m, 1.5, 0), 3.6),
            ((7.0 * m, 2, -4), 2.0), ((10.0 * m, 2, -5.5), 1.0), ((12.0 * m, 2, -5), 0.5)]


def ghost_color(z, ijk, seed):
    """Vertical gradient: white head, lavender belly, cyan glowing wisp, dithered between bands."""
    bands = [(30, 'g1'), (22, 'g2'), (14, 'g3'), (7, 'g4'), (1, 'w1'), (-99, 'w2')]
    for i, (z0, name) in enumerate(bands):
        if z >= z0:
            if i > 0:
                above = bands[i - 1]
                t = (z - z0) / max(1, above[0] - z0)
                if noise(*ijk, seed) < t * 0.6:
                    return above[1]
            return name
    return 'w2'


def body_voxels(mirror):
    tail = tail_points(-1 if mirror else 1)

    def fn(p, ijk):
        d = sd_head(p)
        d = smin(d, sd_cap(p, (0, 0, 21), (0, 0.5, 13), 8.4, 7.6), 3)
        if p[2] < 14:
            d = smin(d, sd_chain(p, tail), 2.5)
        return ghost_color(p[2], ijk, 1) if d <= 0 else None

    vox = voxelize(fn, (-16, 16), (-10, 10), (-8, 34))
    eyes, lids = {}, {}
    for x0, x1 in EYES:
        for x in range(x0, x1 + 1):
            for z in range(EYE_Z[0], EYE_Z[1] + 1):
                if x in (x0, x1) and z in EYE_Z:
                    continue  # rounded corners
                y = min(yy for (xx, yy, zz) in vox if xx == x and zz == z)
                inner = x == (x1 if x0 < 0 else x0)
                vox[(x, y, z)] = 'pupil' if inner and z in (EYE_Z[0] + 2, EYE_Z[0] + 3) else 'eye'
                lids[(x, y - 1, z)] = 'g1'
    return vox, lids


def arm_voxels(side, end):
    def fn(p, ijk):
        return ('g2' if noise(*ijk, 3) > 0.3 else 'g3') if sd_cap(p, (0, 0, 0), end, 2.6, 2.3) <= 0 else None
    return voxelize(fn, (-10, 10), (-6, 6), (-10, 6))


def build_ghost(prefix, root_x, mirror):
    root = empty(prefix, loc=(root_x, 0, 0))
    floater = empty(prefix + '_float', root)
    body_vox, lid_vox = body_voxels(mirror)
    tail_vox = {k: v for k, v in body_vox.items() if k[2] < TAIL_PIVOT[2]}
    head_vox = {k: v for k, v in body_vox.items() if k[2] >= TAIL_PIVOT[2]}
    body = voxel_object(prefix + '_body', head_vox, BODY_PIVOT, floater, loc=(0, 0, BODY_PIVOT[2] * V))
    tail = voxel_object(prefix + '_tail', tail_vox, TAIL_PIVOT, body, loc=rel(TAIL_PIVOT, BODY_PIVOT))
    lid_pivot = (0, 0, EYE_Z[1] + 1)
    lids = voxel_object(prefix + '_lids', lid_vox, lid_pivot, body, loc=rel(lid_pivot, BODY_PIVOT))
    shoulders = {'l': (-8, 0, 18), 'r': (8, 0, 18)}
    arm_l = voxel_object(prefix + '_arm_l', arm_voxels(-1, (-4.5, -0.5, -3.5)), (0, 0, 0), body,
                         loc=rel(shoulders['l'], BODY_PIVOT))
    arm_r = voxel_object(prefix + '_arm_r', arm_voxels(1, (4.5, -0.5, -3.5)), (0, 0, 0), body,
                         loc=rel(shoulders['r'], BODY_PIVOT))
    return dict(root=root, float=floater, body=body, tail=tail, lids=lids, arm_l=arm_l, arm_r=arm_r,
                body_vox=body_vox)


# ---------------------------------------------------------------- miner: hood, cords, pickaxe

def hood_voxels(body_vox):
    def fn(p, ijk):
        x, y, z = p
        if z < 16.5:
            return None
        outer = sd_round_box(p, (0, 1.2, 26.4), (10.8, 9.8, 10.0), 6.5)
        tip = sd_chain(p, [((1, 6, 31), 5.0), ((4.5, 11, 29.5), 2.8), ((7, 13.5, 26.5), 1.2)])
        d = min(outer, tip)
        if d > 0 or sd_head(p) <= 0.2 or ijk in body_vox:
            return None
        e = ((x + 0.5) / 7.9) ** 2 + ((z - 22.0) / 7.0) ** 2
        if y < 0 and e < 1:
            return None  # face opening
        if y < -2 and 1.22 < e < 1.55 and z > 21:
            return 'trim'
        n = noise(*ijk, 11)
        return 'hood' if n > 0.35 else ('hood2' if n > 0.12 else 'hood3')

    vox = voxelize(fn, (-14, 14), (-12, 18), (14, 40))
    for cx in (-3, 1):  # drawstrings hanging over the chest
        for z in range(12, 18):
            ys = [yy for (xx, yy, zz) in body_vox if xx == cx and zz == z]
            if ys:
                vox[(cx, min(ys) - 1, z)] = 'trim' if z == 12 else 'cord'
    return vox


def pickaxe_voxels():
    """Minecraft-style held item: 16x16 sprite, one voxel thick, in the X/Z plane."""
    px = {}
    for i in range(0, 12):
        px[(i, i)] = 'wood2'
        px[(i + 1, i)] = 'wood'
    cx = cy = 1.5
    rc = 12.8
    for u in range(17):
        for v in range(17):
            r = math.hypot(u + 0.5 - cx, v + 0.5 - cy)
            ang = math.degrees(math.atan2(v + 0.5 - cy, u + 0.5 - cx))
            if not 6 <= ang <= 84:
                continue
            t = abs(ang - 45) / 39
            half = 1.35 * (1 - t * t) + 0.4
            if abs(r - rc) <= half:
                px[(u, v)] = ('dia_dark' if r - rc > half - 0.8 else
                              'dia_light' if r - rc < -half + 0.9 else 'dia')
    return {(u, 0, v): m for (u, v), m in px.items()}


def build_miner(x):
    g = build_ghost('GhostMiner', x, mirror=True)
    g['hood'] = voxel_object('GhostMiner_hood', hood_voxels(g['body_vox']), BODY_PIVOT, g['body'])
    hand = (-4.5 * V, -3.4 * V, -3.5 * V)
    g['pickaxe'] = voxel_object('GhostMiner_pickaxe', pickaxe_voxels(), (4.5, 0.5, 4.5), g['arm_l'],
                                loc=hand, size=V * 1.35)
    g['pickaxe'].rotation_euler = (0, math.radians(-78), 0)
    return g


# ---------------------------------------------------------------- wizard: hat, glasses, scroll

def hat_voxels():
    cone = [((0, 0, 32.5), 8.2), ((0.8, 0.8, 38), 5.6), ((2.5, 1.6, 43), 3.4),
            ((5.5, 2.2, 46.5), 1.9), ((9, 2.5, 46), 1.1), ((11, 2.5, 44), 0.7)]

    def fn(p, ijk):
        x, y, z = p
        r = math.hypot(x, y + 0.5)
        brim_z = 32.0 - max(0, (r - 9) * 0.35) - (0.9 if x < -6 else 0)
        brim = r <= 14.5 and abs(z - brim_z) <= 0.7
        d = sd_chain(p, cone)
        if not brim and (d > 0 or z < 32):
            return None
        if not brim and 33 <= z <= 35.5 and d > -1.6:
            return 'gold' if (y < -6 and abs(x) < 1.6) else 'band'
        n = noise(*ijk, 9)
        if brim and r > 12.5:
            return 'hat3'
        return 'hat' if n > 0.3 else ('hat2' if n > 0.1 else 'hat3')

    return voxelize(fn, (-16, 16), (-16, 16), (28, 50))


def glasses_voxels(body_vox):
    vox = {}
    centers = [((x0 + x1) / 2 + 0.5, (EYE_Z[0] + EYE_Z[1]) / 2 + 0.5) for x0, x1 in EYES]
    for x in range(-11, 11):
        for z in range(15, 31):
            for cx, cz in centers:
                d = math.hypot(x + 0.5 - cx, z + 0.5 - cz)
                if 4.0 <= d <= 5.0 or (z == 23 and -2 <= x <= 0):
                    ys = [yy for (xx, yy, zz) in body_vox if xx == x and zz == z]
                    if ys:
                        vox[(x, min(ys) - 1, z)] = 'frame'
    for y in range(-6, 3):  # temples along the sides of the head
        vox[(-10, y, 24)] = 'frame'
        vox[(9, y, 24)] = 'frame'
    return vox


def scroll_voxels():
    vox = {}
    for x in range(0, 7):
        for z in range(1, 10):
            vox[(x, 0, z)] = 'paper' if noise(x, 0, z, 4) > 0.25 else 'paper2'
    for z in (2, 4, 6, 8):
        for x in range(1, 6 if z != 4 else 4):
            vox[(x, 0, z)] = 'ink'
    for z in (0, 10):
        for x in range(-1, 8):
            for y in (-1, 0, 1):
                vox[(x, y, z)] = 'roll2' if x in (-1, 7) else 'roll'
    return vox


def build_wizard(x):
    g = build_ghost('GhostWizard', x, mirror=False)
    g['hat'] = voxel_object('GhostWizard_hat', hat_voxels(), (0, 0, 32), g['body'], loc=rel((0, 0, 32), BODY_PIVOT))
    g['hat'].rotation_euler = (0, math.radians(-8), 0)
    g['glasses'] = voxel_object('GhostWizard_glasses', glasses_voxels(g['body_vox']), BODY_PIVOT, g['body'])
    g['scroll'] = voxel_object('GhostWizard_scroll', scroll_voxels(), (3.5, 0, 5), g['body'],
                               loc=(0.55, -0.62, -0.28))
    return g


# ---------------------------------------------------------------- animation (seamless loop)

def S(t, k=1, ph=0.0):
    return math.sin(2 * math.pi * (k * t + ph))


def key_loop(obj, fn, step=3):
    """fn(t) -> dict(loc=(..), rot=(degrees..), scale=(..)) for t in [0, 1)."""
    for f in range(0, FRAMES + 1, step):
        v = fn((f % FRAMES) / FRAMES)
        for attr, key in (('loc', 'location'), ('rot', 'rotation_euler'), ('scale', 'scale')):
            if attr in v:
                val = [math.radians(a) for a in v[attr]] if attr == 'rot' else v[attr]
                setattr(obj, key, val)
                obj.keyframe_insert(key, frame=f)


def key_blink(lids, frames):
    keys = {0: 0.001, FRAMES: 0.001}
    for b in frames:
        keys.update({b - 3: 0.001, b - 1: 0.7, b: 1.0, b + 1: 1.0, b + 3: 0.001})
    for f, s in sorted(keys.items()):
        lids.scale = (1, 1, s)
        lids.keyframe_insert('scale', frame=f)


def animate_common(g, sign, phase):
    key_loop(g['float'], lambda t: dict(loc=(0.04 * sign * S(t, 1, phase + 0.25), 0, 0.12 * S(t, 1, phase)),
                                        rot=(2.5 * S(t, 2, phase), 3 * sign * S(t, 1, phase + 0.4),
                                             8 * sign * S(t, 1, phase + 0.1))))
    key_loop(g['tail'], lambda t: dict(rot=(7 * S(t, 1, phase - 0.2), 9 * sign * S(t, 1, phase - 0.1),
                                            12 * sign * S(t, 1, phase - 0.15))))


def animate_miner(g):
    animate_common(g, -1, 0.0)
    # pickaxe arm: two quick chops per loop
    key_loop(g['arm_l'], lambda t: dict(rot=(-10, 38 + 22 * max(0, S(t, 2)) ** 3, -6)), step=2)
    key_loop(g['arm_r'], lambda t: dict(rot=(-20 + 8 * S(t, 1, 0.3), 10 * S(t, 1, 0.55), 0)))
    key_blink(g['lids'], [80])


def animate_wizard(g):
    animate_common(g, 1, 0.5)
    key_loop(g['hat'], lambda t: dict(rot=(4 * S(t, 1, 0.1), -8 + 5 * S(t, 1, 0.35), 4 * S(t, 2))))
    key_loop(g['scroll'], lambda t: dict(loc=(0.55, -0.62, -0.28 + 0.03 * S(t, 1, 0.3)),
                                         rot=(6, -12 + 4 * S(t, 1, 0.5), 16)))
    key_loop(g['arm_r'], lambda t: dict(rot=(-55 + 5 * S(t, 1, 0.2), 0, 30 + 4 * S(t, 2))))
    key_loop(g['arm_l'], lambda t: dict(rot=(-15, 30 + 22 * S(t, 2, 0.1), 0)))
    key_blink(g['lids'], [34, 42])


# ---------------------------------------------------------------- scene and export

def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.actions):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def descendants(o):
    out = [o]
    for c in o.children:
        out += descendants(c)
    return out


def export(g, path):
    root = g['root']
    keep = tuple(root.location)
    root.location = (0, 0, 0)
    bpy.ops.object.select_all(action='DESELECT')
    for o in descendants(root):
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='SCENE', export_force_sampling=True,
        export_frame_range=True, export_apply=False, export_yup=True,
        export_lights=False, export_cameras=False,
    )
    root.location = keep


def main():
    clear_scene()
    sc = bpy.context.scene
    sc.render.fps = 30
    sc.frame_start, sc.frame_end = 0, FRAMES - 1
    ghosts = {}
    if 'miner' in BUILD:
        ghosts['miner'] = build_miner(-1.6)
        animate_miner(ghosts['miner'])
    if 'wizard' in BUILD:
        ghosts['wizard'] = build_wizard(1.6)
        animate_wizard(ghosts['wizard'])
    sc.frame_set(0)
    if EXPORT:
        os.makedirs(ASSETS, exist_ok=True)
        for name, g in ghosts.items():
            export(g, os.path.join(ASSETS, f'ghost-{name}.glb'))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'hero_ghosts.blend'))
    return {n: sum(len(o.data.polygons) for o in descendants(g['root']) if o.type == 'MESH') for n, g in ghosts.items()}


print('HERO_GHOSTS', main())
