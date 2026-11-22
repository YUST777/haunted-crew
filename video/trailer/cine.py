"""Haunted Crew cold open: cinematic procedural office (look: ref/target_look.webp). Cycles, stills per shot.
blender -b -P cine.py -- --shots 2,9 --res 960 --samples 96 --out DIR
Shots: 1..10, 11a 11b 11c (montage panels), 12.  Post (bloom, montage, sheet): sheet.py
"""
import bpy, sys, os, math, random, time
from mathutils import Vector, Matrix, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
TEX = ROOT + '/assets/assets/minecraft/textures/block/'; UI = ROOT + '/ui/'
FONT = ROOT + '/../../shared/fonts/minecraft/Minecraft.ttf'
ALL = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11a', '11b', '11c', '12']
R = math.radians
sys.path.insert(0, HERE); import cut
K = 0.0; T = 0.0; CUR = ''; WHP = 0.0; DUR = 1.0   # shot progress 0..1, time in s, current shot, whip amount, shot length in s (stills: K = T = 0)
LAMPS = []   # static lantern lights (object, power, phase): they flicker
ease = lambda k: k * k * (3 - 2 * k)
# camera travel per shot (added to the still's camera position over the shot), roll change in degrees
MOVE = {'1': ((.5, 1.2, .1), 0), '2': ((0, 2.5, -1.2), 0), '3': ((0, 7.0, 0), 0), '4': ((.3, .3, -.05), 0), '5': ((.25, -.1, .1), 0), '6': ((.6, 1.2, 0), 0),
        '8': ((.3, .6, .05), -6), '9': ((-.2, -.8, 0), 0), '10': ((.4, 1.6, .05), 0), '11a': ((.2, .7, 0), 0), '11b': ((-.4, .7, 0), 0), '11c': ((-.1, .7, 0), 0), '12': ((0, 1.0, 0), 0)}
SEQ = cut.SEQ

def arg(n, d):
    a = sys.argv; return type(d)(a[a.index('--' + n) + 1]) if '--' + n in a else d

# ---------- materials ----------
M = {}
def mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True; M[name] = m
    return m, m.node_tree, next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')

def m_tex(name, tex, tint, rough=0.8, scale=1.0, wet=False):
    m, nt, b = mat(name); N = nt.nodes.new; L = nt.links.new
    tc = N('ShaderNodeTexCoord'); mp = N('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale,) * 3
    im = N('ShaderNodeTexImage'); im.image = bpy.data.images.load(TEX + tex + '.png', check_existing=True)
    im.interpolation = 'Closest'; im.projection = 'BOX'
    mul = N('ShaderNodeVectorMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = tint
    L(tc.outputs['Object'], mp.inputs['Vector']); L(mp.outputs[0], im.inputs['Vector']); L(im.outputs['Color'], mul.inputs[0]); L(mul.outputs[0], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    if wet:   # puddles: roughness varies with noise
        no = N('ShaderNodeTexNoise'); no.inputs['Scale'].default_value = 0.5; mr = N('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = 0.4; mr.inputs['From Max'].default_value = 0.65; mr.inputs['To Min'].default_value = 0.04; mr.inputs['To Max'].default_value = 0.35
        L(tc.outputs['Object'], no.inputs['Vector']); L(no.outputs[0], mr.inputs['Value']); L(mr.outputs[0], b.inputs['Roughness'])

def m_plain(name, col, rough=0.6, emit=0.0, ecol=None):
    m, nt, b = mat(name); b.inputs['Base Color'].default_value = (*col, 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Emission Color'].default_value = (*(ecol or col), 1); b.inputs['Emission Strength'].default_value = emit
    return b

def m_img(name, path, strength, alpha=False, closest=False):
    if name in M: return name
    m, nt, b = mat(name); im = nt.nodes.new('ShaderNodeTexImage'); im.image = bpy.data.images.load(path, check_existing=True)
    if closest: im.interpolation = 'Closest'
    b.inputs['Base Color'].default_value = (0, 0, 0, 1); b.inputs['Roughness'].default_value = 0.25
    nt.links.new(im.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = strength
    if alpha: nt.links.new(im.outputs['Alpha'], b.inputs['Alpha'])
    return name

def make_materials():
    m_tex('floor', 'deepslate_tiles', (0.30, 0.36, 0.55), scale=0.5, wet=True)
    m_tex('wall', 'deepslate_bricks', (0.35, 0.40, 0.55), rough=0.9)
    m_tex('wood', 'dark_oak_planks', (0.9, 0.9, 1.0), rough=0.7)
    m_tex('wood2', 'spruce_planks', (0.7, 0.7, 0.8), rough=0.55)
    m_tex('book', 'bookshelf', (0.8, 0.8, 0.9), rough=0.8)
    m_tex('pot', 'terracotta', (1, 1, 1), rough=0.8)
    m_plain('metal', (0.015, 0.017, 0.025), 0.35); m_plain('black', (0, 0, 0), 1.0)
    m_plain('leaf1', (0.10, 0.30, 0.04), 0.6); m_plain('leaf2', (0.28, 0.42, 0.05), 0.6)
    m_plain('lantern', (1, 0.5, 0.1), 0.5, 9, (1, 0.4, 0.05)); m_plain('keyglow', (1, 0.4, 0.05), 0.5, 1.6, (1, 0.38, 0.03))
    m_plain('key', (0.03, 0.035, 0.05), 0.4); m_plain('keyhit', (1, 0.6, 0.2), 0.4, 14, (1, 0.5, 0.1)); m_plain('mote', (0, 0, 0), 0.5, 1.5, (0.6, 0.75, 1)); m_plain('screen_off', (0.005, 0.006, 0.01), 0.15)
    M['sidewin_b'] = m_plain('sidewin', (0, 0, 0), 0.3, 0.3, (0.05, 0.15, 0.8))
    m_plain('silh', (0, 0, 0), 0.5, 3.5, (1, 0.36, 0.03))
    m_plain('eye_dark', (0.004, 0.006, 0.02), 0.2); m_plain('eye_orange', (1, 0.4, 0.03), 0.5, 3.2, (1, 0.36, 0.02))
    m_tex('logo', 'cracked_stone_bricks', (1.0, 0.55, 0.2), rough=0.85, scale=3.2)
    m_plain('title', (0.95, 0.6, 0.3), 0.6, 1.0, (1, 0.5, 0.12)); m_plain('tag', (1, 1, 1), 0.6, 1.2, (1, 0.8, 0.55))
    # ghost: glowing frosted voxels (per-voxel flicker + brighter edges)
    m, nt, b = mat('ghost'); N = nt.nodes.new; L = nt.links.new
    b.inputs['Base Color'].default_value = (0.5, 0.66, 1, 1); b.inputs['Roughness'].default_value = 0.45
    b.inputs['Subsurface Weight'].default_value = 1.0; b.inputs['Subsurface Radius'].default_value = (0.6, 0.8, 1.0); b.inputs['Subsurface Scale'].default_value = 0.4
    b.inputs['Emission Color'].default_value = (0.42, 0.62, 1, 1)
    tc = N('ShaderNodeTexCoord'); sc = N('ShaderNodeVectorMath'); sc.operation = 'SCALE'; sc.inputs['Scale'].default_value = 5
    ad = N('ShaderNodeVectorMath'); ad.inputs[1].default_value = (0.37, 0.37, 0.37); fl = N('ShaderNodeVectorMath'); fl.operation = 'FLOOR'
    wn = N('ShaderNodeTexWhiteNoise'); wn.noise_dimensions = '3D'; r1 = N('ShaderNodeMapRange'); r1.inputs['To Min'].default_value = 0.7; r1.inputs['To Max'].default_value = 1.3
    lw = N('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.3; r2 = N('ShaderNodeMapRange'); r2.inputs['To Min'].default_value = 0.55; r2.inputs['To Max'].default_value = 2.2
    mu = N('ShaderNodeMath'); mu.operation = 'MULTIPLY'; m2 = N('ShaderNodeMath'); m2.operation = 'MULTIPLY'; m2.inputs[1].default_value = arg('ghostglow', 0.3)
    L(tc.outputs['Object'], sc.inputs[0]); L(sc.outputs[0], ad.inputs[0]); L(ad.outputs[0], fl.inputs[0]); L(fl.outputs[0], wn.inputs['Vector'])
    L(wn.outputs['Value'], r1.inputs['Value']); L(lw.outputs['Facing'], r2.inputs['Value']); L(r1.outputs[0], mu.inputs[0]); L(r2.outputs[0], mu.inputs[1])
    L(mu.outputs[0], m2.inputs[0]); L(m2.outputs[0], b.inputs['Emission Strength'])
    r3 = N('ShaderNodeMapRange'); r3.inputs['To Min'].default_value = arg('ghostalpha', 1.0); r3.inputs['To Max'].default_value = 1.0   # owner wants solid ghosts: 1.0 = opaque (lower = see-through front)
    L(lw.outputs['Facing'], r3.inputs['Value']); L(r3.outputs[0], b.inputs['Alpha'])
    # moon
    m, nt, b = mat('moon'); N = nt.nodes.new; L = nt.links.new
    no = N('ShaderNodeTexNoise'); no.inputs['Scale'].default_value = 0.35; no.inputs['Detail'].default_value = 4
    mr = N('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.35; mr.inputs['From Max'].default_value = 0.7; mr.inputs['To Min'].default_value = 1.2; mr.inputs['To Max'].default_value = 6
    tc = N('ShaderNodeTexCoord'); L(tc.outputs['Object'], no.inputs['Vector']); L(no.outputs[0], mr.inputs['Value']); L(mr.outputs[0], b.inputs['Emission Strength'])
    b.inputs['Emission Color'].default_value = (0.45, 0.65, 1, 1); b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    # fog volume
    m, nt, b = mat('fog'); out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'); nt.nodes.remove(b)
    v = nt.nodes.new('ShaderNodeVolumeScatter'); v.inputs['Density'].default_value = arg('fog', 0.009); v.inputs['Anisotropy'].default_value = 0.55
    v.inputs['Color'].default_value = (0.75, 0.85, 1, 1); nt.links.new(v.outputs[0], out.inputs['Volume'])

# ---------- geometry ----------
G = {}
FACES = ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))
def boxv(x0, y0, z0, x1, y1, z1): return [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
def B(m, x0, y0, z0, x1, y1, z1):
    v, f = G.setdefault(m, ([], [])); n = len(v); v += boxv(x0, y0, z0, x1, y1, z1); f += [tuple(n + i for i in q) for q in FACES]
def C(m, x, y, z, sx, sy, sz): B(m, x - sx / 2, y - sy / 2, z, x + sx / 2, y + sy / 2, z + sz)

def obj(coll, name, me, m=None):
    if m: me.materials.append(M[m])
    o = bpy.data.objects.new(name, me); coll.objects.link(o); return o
def flush(coll):
    for m, (v, f) in G.items():
        me = bpy.data.meshes.new(m); me.from_pydata(v, [], f); o = obj(coll, m, me, m)
        if m in ('lantern', 'fog'): o.visible_shadow = False    # point light sits inside the glow cube
    G.clear()
def quad(coll, m, w, h, mw):
    me = bpy.data.meshes.new('q'); me.from_pydata([(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new()
    for i, c in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))): uv.data[i].uv = c
    o = obj(coll, 'q_' + m, me, m); o.matrix_world = mw; return o
def facing(p, rz=0.0, tilt=0.0):   # quad upright, front towards -Y (then turned rz about Z)
    return Matrix.Translation(p) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(R(90) + tilt, 4, 'X')
def lamp(coll, loc, col, power, r=0.08):
    l = bpy.data.lights.new('L', 'POINT'); l.color = col; l.energy = power; l.shadow_soft_size = r
    o = bpy.data.objects.new('L', l); o.location = loc; coll.objects.link(o); return o

def lantern(coll, x, y, z, s=1.0, p=20):
    C('metal', x, y, z, .34 * s, .34 * s, .05 * s); C('metal', x, y, z + .42 * s, .34 * s, .34 * s, .05 * s); C('metal', x, y, z + .47 * s, .14 * s, .14 * s, .08 * s)
    for dx in (-1, 1):
        for dy in (-1, 1): C('metal', x + dx * .15 * s, y + dy * .15 * s, z + .05 * s, .04 * s, .04 * s, .37 * s)
    C('lantern', x, y, z + .07 * s, .24 * s, .24 * s, .33 * s); o = lamp(coll, (x, y, z + .24 * s), (1, 0.48, 0.13), p)
    if coll.name == 'static': LAMPS.append((o, p, x * 7 + y))

def plant(x, y, z, s=1.0, rnd=random):
    C('pot', x, y, z, .4 * s, .4 * s, .34 * s); v = .11 * s
    for k in range(10):
        a = rnd.uniform(0, 6.28); px, py, pz = x, y, z + .34 * s; lean = rnd.uniform(.25, .9)
        for i in range(rnd.randint(4, 9)):
            C(rnd.choice(('leaf1', 'leaf2')), px, py, pz, v, v, v); pz += v; px += math.cos(a) * v * lean * i / 4; py += math.sin(a) * v * lean * i / 4

DESK_X = (-6.9, -3.1, 3.1, 6.9); DESK_Y = (4, 7.5, 11, 14.5, 18, 21.5, 25)
def desk(coll, x, y, rnd, lit, chair=True, deco=True, typ=False):
    B('wood2', x - 1.5, y - .75, .78, x + 1.5, y + .75, .9)
    for sx in (-1, 1): B('wood', x + sx * 1.15 - .3, y - .7, 0, x + sx * 1.15 + .3, y + .7, .78)
    C('metal', x, y + .5, .9, .5, .3, .05); C('metal', x, y + .56, .95, .1, .06, .3); B('metal', x - .66, y + .5, 1.15, x + .66, y + .58, 1.97)
    sm = m_img('code%d' % lit, UI + 'code%d.png' % lit, 1.2) if lit else 'screen_off'
    if not typ: quad(coll, sm, 1.22, .72, facing((x, y + .495, 1.56)))
    B('metal', x - .46, y - .71, .9, x + .46, y - .39, .93)      # keyboard
    for i in range(11):
        for j in range(4):
            m = 'keyglow' if rnd.random() < .3 else 'key'
            if not typ: C(m, x - .4 + i * .08, y - .67 + j * .08, .93, .06, .06, .025)
    if chair: C('wood', x, y - 1.3, 0, .6, .6, .5); B('wood', x - .3, y - 1.62, .5, x + .3, y - 1.52, 1.25)
    k = rnd.random() if deco else 1
    if k < .3: plant(x + rnd.choice((-1.1, 1.1)), y + .2, .9, .8, rnd)
    elif k < .5: lantern(coll, x + rnd.choice((-1.1, 1.1)), y + .1, .9, .8, 8)
    if not lit and (x * 3 + y) % 5 < 2.5: sx = 1 if x * y % 2 < 1 else -1; quad(coll, 'web', .7, .7, facing((x + sx * .66, y + .49, 1.17)))   # cobweb from monitor corner to desk

def typing_desk(dyn):
    """desk (3.1, 11): the code types on the monitor at 12 chars/s and one key goes down and flashes per character"""
    x, y = 3.1, 11; n = int(T * 12) if T > 0 else 150; rnd = random.Random(5); hit = random.Random(n).sample(range(44), 2); old = random.Random(n - 1).sample(range(44), 2)
    f = min(n, NTY); quad(dyn, m_img('ty%d' % f, UI + 'typed_%03d.png' % f, 1.6), 1.22, .72, facing((x, y + .495, 1.56)))
    for i in range(11):
        for j in range(4):
            k = i * 4 + j; m = 'keyglow' if rnd.random() < .1 else 'key'   # mostly dark so the pressed keys read
            C('keyhit' if k in hit else 'keyglow' if k in old else m, x - .4 + i * .08, y - .67 + j * .08, .93, .06, .06, .01 if k in hit else .025)
    lamp(dyn, (x, y - .55, 1.05), (1, 0.45, 0.1), 2 + 3 * (n % 2), .05)
NTY = len([f for f in os.listdir(UI) if f.startswith('typed_')]) - 1; NUI = len([f for f in os.listdir(UI) if f.startswith('screen_')])

def build_static(coll):
    rnd = random.Random(7); m_img('web', UI + 'web.png', 0.12, alpha=True, closest=True)
    B('floor', -9, -6, -.2, 9, 30, 0); B('wall', -9.5, -6, 11, 9.5, 30.5, 11.5); B('wall', -9.5, -6.5, 0, 9.5, -6, 11)
    B('wall', -9.5, -6, 0, -9, 30.5, 11); B('wall', 9, -6, 0, 9.5, 30.5, 11)
    B('wall', -9, 30, 0, -4, 30.5, 11); B('wall', 4, 30, 0, 9, 30.5, 11); B('wall', -4, 30, 0, 4, 30.5, 1); B('wall', -4, 30, 9.5, 4, 30.5, 11)
    for x in (-4, -2, 0, 2, 4): B('metal', x - .16, 30.1, 1, x + .16, 30.35, 9.5)
    for z in (1, 3.1, 5.2, 7.3, 9.5): B('metal', -4, 30.1, z - .16, 4, 30.35, z + .16)
    for y in range(-2, 30, 4):
        B('wood', -9, y - .25, 10.3, 9, y + .25, 11)
        for s in (-1, 1):
            B('wood', s * 9 - .4 * (s > 0), y - .3, 0, s * 9 + .4 * (s < 0), y + .3, 11)
            x0, x1 = (-9, -8.35) if s < 0 else (8.35, 9)
            B('book', x0, y + .5, 0, x1, y + 3.5, 4)
            quad(coll, 'web', 3.4, 3.4, facing((s * 8.6, y - .33, 10.3)))   # corner cobweb: pillar meets ceiling beam
            B('sidewin', min(s * 8.99, s * 8.95), y + 1.2, 5, max(s * 8.99, s * 8.95), y + 2.8, 9)
            B('metal', min(s * 8.9, s * 8.98), y + 1.95, 5, max(s * 8.9, s * 8.98), y + 2.05, 9); B('metal', min(s * 8.9, s * 8.98), y + 1.2, 6.95, max(s * 8.9, s * 8.98), y + 2.8, 7.05)
    for sx in (-1, 1):
        for z in (1, 9.5): quad(coll, 'web', 3.0, 3.0, facing((sx * 4, 30.05, z)))   # window corners
    B('fog', -9, -6, 0, 9, 30, 11)
    for y in DESK_Y:
        for x in DESK_X:
            hero = abs(x) < 4 and y == 11
            lit = 1 if hero else (rnd.choice((1, 2, 3)) if rnd.random() < .3 else 0)
            desk(coll, x, y, rnd, lit, chair=not (abs(x) < 4 and y in (11, 14.5)), deco=not hero, typ=x == 3.1 and y == 11)
        for s in (-1, 1):
            if rnd.random() < .8: lantern(coll, s * 1.3, y - 1.0 + rnd.uniform(-.3, .3), 0, 1.0, 20)
            if rnd.random() < .35: plant(s * (1.3 + rnd.uniform(0, .15)), y + 1.3, 0, 1.0, rnd)
    flush(coll)

def ghost(coll, pos, rz=0.0, s=1.0, eyes='dark', arms=(0, 0), tilt=0.0, nod=0.0):
    """front = local -Y. arms: degrees raised forward (L, R)"""
    root = bpy.data.objects.new('ghost', None); coll.objects.link(root); root.scale = (s, s, s)
    root.location = (pos[0], pos[1], pos[2] + .05 * s * math.sin(3.8 * T + pos[0] * 3) * (T > 0))   # idle float
    root.rotation_euler = (R(nod + 2 * math.sin(2.9 * T + pos[1]) * (T > 0)), R(tilt + 3 * math.sin(2.3 * T + pos[0]) * (T > 0)), R(rz))
    def part(m, lo, hi, org=(0, 0, 0), rx=0.0, eye=False):
        me = bpy.data.meshes.new('g'); me.from_pydata(boxv(*lo, *hi), [], FACES); o = obj(coll, 'g_' + m, me, m)
        o.parent = root; o.location = org; o.rotation_euler = (rx, 0, 0); o['eye'] = eye; return o
    for sx in (-1, 1):
        part('ghost', (sx * .17 - .11, -.11, 0), (sx * .17 + .11, .11, .25))
        part('ghost', (-.11, -.11, -.55), (.11, .11, 0), (sx * .46, 0, .72), -R(arms[sx > 0]))
        part('eye_' + eyes, (sx * .2 - .075, -.47, 1.12), (sx * .2 + .075, -.44, 1.42), eye=True)
    part('eye_' + eyes, (-.09, -.47, .93), (.09, -.44, 1.01), eye=True)   # mouth
    for i in (1, 2, 3):   # wispy tail trailing behind
        h = .11 - .025 * i; part('ghost', (-h, -h, -h), (h, h, h), (.07 * i * math.sin(4 * T + i + pos[0]), .13 * i, .1 - .14 * i))
    part('ghost', (-.35, -.22, .25), (.35, .22, .78)); part('ghost', (-.55, -.45, .75), (.55, .45, 1.75))
    return root

# ---------- camera ----------
def set_cam(cam, pos, look, lens, fstop, focus, roll=0.0):
    d, dr = MOVE.get(CUR, ((0, 0, 0), 0)); e = .6 * K + .4 * ease(K)   # mostly linear: the camera is still moving at the cut (pure ease in/out felt stiff)
    hh = Vector((math.sin(2.1 * T + 1), math.sin(1.7 * T), math.sin(2.6 * T + 2))) * .012 * (T > 0)   # handheld drift
    pos = tuple(Vector(pos) + Vector(d) * e + hh); roll += dr * e + .3 * math.sin(1.3 * T) * (T > 0); fstop *= arg('fmul', 0.7)
    if CUR in ('3', '12'): focus = tuple(Vector(focus) + Vector(d) * e)   # aisle push: focus travels with the camera
    q = Quaternion((0, 0, 1), -WHP * R(32)) @ (Vector(look) - Vector(pos)).to_track_quat('-Z', 'Y') @ Quaternion((0, 0, 1), R(roll))   # whip pan about the vertical
    cam.location = pos; cam.rotation_mode = 'QUATERNION'; cam.rotation_quaternion = q; cam.data.lens = lens
    cam.data.dof.use_dof = True; cam.data.dof.aperture_fstop = fstop
    cam.data.dof.focus_distance = max(0.2, (Vector(focus) - Vector(pos)).dot(q @ Vector((0, 0, -1))))
    return Matrix.LocRotScale(Vector(pos), q, None)
def cam_at(mw, lens, u, v, d):   # matrix of a camera-facing card at screen pos (u, v in -1..1) and distance d
    t = 18 / lens; return mw @ Matrix.Translation((u * t * d, v * t * d * 9 / 16, -d))

SIL = ['.....OOOOOOO.....', '...OOOOOOOOOOO...', '..OOOODDDDDOOOO..', '.OOOODDDDDDDOOOO.', '.OOODDEDDDEDDOOO.', 'OOOODDEDDDEDDOOOO',
       'OOOODDDDDDDDDOOOO', 'OOODDDDDDDDDDDOOO', 'OOODDDDDDDDDDDOOO', 'OODDDDDDDDDDDDDOO', 'OODDDDDDDDDDDDDOO', 'DDDDDDDDDDDDDDDDD']

def setup(sh, S):
    global CUR; CUR = sh
    """build shot `sh` into the dyn collection. S: dict(cam, dyn, sun, scene, world_bg)"""
    dyn, cam = S['dyn'], S['cam']
    S['sun'].hide_render = False; S['scene'].view_settings.exposure = arg('exp', 0.0); only_eyes = False
    sw = M['sidewin_b']; sw.inputs['Emission Color'].default_value = (0.05, 0.15, 0.8, 1); sw.inputs['Emission Strength'].default_value = 0.3
    HERO = (0.9, 10.4, 0.35); DESKG = (3.1, 10.0, 0.6); typing_desk(dyn)
    for o, p, ph in LAMPS: o.data.energy = p * (1 + (.18 * math.sin(9 * T + ph) + .1 * math.sin(23 * T + 2 * ph)) * (T > 0))   # lantern flicker
    rnd = random.Random(11)
    for i in range(arg('motes', 500)):   # dust motes drifting through the hall
        x, y, z, ph = rnd.uniform(-8, 8), rnd.uniform(-5, 29), rnd.uniform(.2, 6), rnd.uniform(0, 6.28); h = rnd.uniform(.008, .02)
        C('mote', x + .15 * math.sin(.5 * T + ph), y + .04 * T, z + .1 * math.sin(.4 * T + 2 * ph), h, h, h)
    ty = 12 * math.sin(37.7 * T);   # 6 Hz per hand = 12 key presses a second
    desk_ghost = lambda: ghost(dyn, DESKG, 180, .85, arms=(80 + ty, 72 - ty))   # typing
    if sh == '1':
        mw = set_cam(cam, (-1.75, 1.8, 1.3), (0.6, 30, 3.4), 50, 0.9, (-1.3, 10.3, 0.3)); S['scene'].view_settings.exposure -= 0.7
        plant(-2.2, 3.5, 0.9, 1.7, random.Random(3))
    elif sh == '2':
        mw = set_cam(cam, (0, -4.5, 3.9), (0, 30, 4.5), 45, 2.0, (0, 12, 1))   # crane down
        ghost(dyn, (3.1, 13.6, .6), 180, .8, arms=(75, 75))
    elif sh == '3':
        mw = set_cam(cam, (0.25, 2.2, 0.5), (0.3, 30, 2.0), 24, 1.2, (0, 8.5, 0.5))
    elif sh == '4':
        mw = set_cam(cam, (1.2, 9.2, 1.75), (3.0, 11.2, 1.45), 30, 1.8, (3.1, 11.5, 1.56)); desk_ghost()   # from the side: ghost in profile, the typed code readable
        ghost(dyn, (6.9, 13.5, .6), 150, .7, arms=(60, 60))
    elif sh == '5':
        mw = set_cam(cam, (2.2, 11.15, 1.25), (3.05, 10.42, 1.0), 40, 2.0, (2.9, 10.45, 1.05)); desk_ghost()
    elif sh == '6':
        mw = set_cam(cam, (-1.3, 6.2, 1.5), (1.4, 11, 1.4), 30, 1.8, HERO[:2] + (1.5,))
        ghost(dyn, HERO, -22, 1.0, arms=(25, 10), tilt=-6); ghost(dyn, (-3.2, 12.4, .55), -15, .8)
        ghost(dyn, (4.2, 13.5, 2.5), -35, .65, arms=(0, 95)); lantern(dyn, 4.25, 13.0, 2.75, .6, 10)
    elif sh == '7':
        mw = set_cam(cam, (0.9, 6.0, 1.5), (0.9, 10.4, 1.6), 32, 4, HERO); ghost(dyn, HERO, 0, 1.0, 'orange'); only_eyes = True
    elif sh == '8':
        mw = set_cam(cam, (-0.3, 8.3, 0.7), (1.05, 10.2, 1.55), 35, 2.0, (0.9, 9.95, 1.6), roll=14)
        ghost(dyn, HERO, -15 + 130 * (1 - ease(min(1, K * 2.2))) * (T > 0), 1.0, 'orange', arms=(20, 0)); lamp(dyn, (0.0, 9.5, 0.6), (1, 0.4, 0.06), 60, 0.2)
    elif sh == '9':
        mw = set_cam(cam, (-0.9, 6.4, 0.5), (0.9, 10.4, 1.5), 28, 1.6, (0.9, 10, 1.5))
        ghost(dyn, HERO, -12, 1.0, 'orange', arms=(30, 5), nod=6); lamp(dyn, (-0.1, 9.5, 0.5), (1, 0.4, 0.06), 50, 0.2)
        ghost(dyn, (-1.3, 12.2, .3), -10, .6, 'orange', arms=(20, 20)); ghost(dyn, (2.9, 12.5, 1.3), 15, .55, 'orange', arms=(40, 0))
    elif sh == '10':
        mw = set_cam(cam, (-0.6, 5.6, 1.9), (0.4, 13, 2.2), 32, 2.8, (1.0, 13, 2.6))
        f = int(1 + K * (NUI - 1)) if T > 0 else int(arg('uiframe', 50)); quad(dyn, m_img('ui%d' % f, UI + 'screen_%04d.png' % f, 2.0), 5.2, 2.43, facing((1.2, 13, 2.5), R(-10)))
        ghost(dyn, (-1.9, 8.6, .35), 200, 1.0, arms=(0, 30)); ghost(dyn, (-2.1, 11.0, 1.9), 195, .7)
    elif sh == '11a':
        mw = set_cam(cam, (-0.9, 2.2, 1.3), (0, 6, 1.15), 34, 2.0, (0, 5.6, 1.2)); ghost(dyn, (0, 6, .3), 12, 1.0, arms=(55, 55))
        quad(dyn, m_img('bp', UI + 'blueprint.png', 2.2), 1.5, 1.03, facing((0, 5.42, .82), R(12), R(-12)))
    elif sh == '11b':
        mw = set_cam(cam, (5.3, 6.8, 1.8), (3.2, 10.6, 1.5), 34, 2.0, (3.1, 10, 1.6)); desk_ghost()
    elif sh == '11c':
        mw = set_cam(cam, (0.6, 11.4, 1.3), (0, 15.6, 0.95), 34, 2.0, (0, 15.4, 1)); ghost(dyn, (-0.55, 16, .3), -20, 1.0, arms=(0, 45))
        C('metal', 0.5, 15.2, 0, .95, .95, .95); quad(dyn, m_img('dep', UI + 'deploy.png', 6, closest=True), .8, .8, facing((0.5, 14.72, .475)))
        lamp(dyn, (0.5, 15.2, 1.25), (1, 0.5, 0.1), 40, 0.3)
    elif sh == '12':   # outro: Minecraft-trailer style block logo over the blurred office
        mw = set_cam(cam, (0, -5, 2.7), (0, 30, 5.4), 42, 0.5, (0, 0.98, 3.16)); S['sun'].hide_render = True   # focus on the logo, 6 m out
        sw.inputs['Emission Color'].default_value = (1, 0.36, 0.03, 1); sw.inputs['Emission Strength'].default_value = 1.5
        tilt = Matrix.Rotation(R(-9), 4, 'X')   # logo leans back, seen from below
        for body, size, v, m, ex, off, back, mx in (('HAUNTED\nCREW', .62, .26, 'black', .3, .034, -.04, tilt), ('HAUNTED\nCREW', .62, .26, 'logo', .3, .009, 0, tilt),
                                                   ('Your Kiro agents, haunting Minecraft.', .17, -.5, 'tag', 0, 0, 0, Matrix())):
            cu = bpy.data.curves.new('T', 'FONT'); cu.body = body; cu.font = bpy.data.fonts.load(FONT, check_existing=True); cu.size = size
            cu.align_x = 'CENTER'; cu.extrude = ex; cu.offset = off; cu.space_line = .95; cu.space_character = 1.1 if ex else 1; cu.materials.append(M[m])
            o = bpy.data.objects.new('T', cu); dyn.objects.link(o); o.matrix_world = cam_at(mw, cam.data.lens, 0, v, 6) @ mx @ Matrix.Translation((0, 0, back))
            if T > 0 and ex: z = 1 + 2.2 * (1 - min(1, K / cut.SLAM) ** 2); o.matrix_world = o.matrix_world @ Matrix.Diagonal((z, z, z, 1))   # logo slams in
            if T > 0 and not ex: o.hide_render = K < .45
        t = (K - cut.SLAM) * DUR; c0 = cam_at(mw, cam.data.lens, 0, .2, 6); rnd = random.Random(4)
        if T > 0 and t > 0:   # the slam throws stone chips towards the camera and lights the room
            for i in range(70):
                v = Vector((rnd.uniform(-1, 1) * 2.4, rnd.uniform(-.5, 1) * 1.6, rnd.uniform(.3, 3))) * 2.2; h = rnd.uniform(.03, .1)
                p = c0 @ (Vector((rnd.uniform(-1.6, 1.6), rnd.uniform(-.5, .5), 0)) + v * t + Vector((0, -2.5 * t * t, 0))); C('logo', p.x, p.y, p.z, h, h, h)
            lamp(dyn, (c0 @ Vector((0, 0, -1.2))), (1, 0.45, 0.08), 3000 * max(0, 1 - t / .5) + 150, .6)
        for u, v, d, col, pw in ((-.5, 1.3, 4.6, (1, .78, .5), arg('logokey', 900.0)), (.7, -.9, 4.8, (1, .4, .12), arg('logofill', 150.0))):
            lamp(dyn, cam_at(mw, cam.data.lens, u, v, d).translation, col, pw, .5)
    # moon: always seen through the back window from this camera
    d = (Vector((1.3, 30.3, 7.7)) - Vector(cam.location)).normalized(); p = Vector(cam.location) + d * 200
    me = bpy.data.meshes.new('moon'); n = 40; me.from_pydata([(7.5 * math.cos(i * 6.2832 / n), 7.5 * math.sin(i * 6.2832 / n), 0) for i in range(n)], [], [tuple(range(n))])
    o = obj(dyn, 'moon', me, 'moon'); o.matrix_world = Matrix.LocRotScale(p, d.to_track_quat('-Z', 'Y'), None); o.hide_render = sh == '12'
    flush(dyn)
    S['bg'].inputs['Strength'].default_value = 0 if only_eyes else 1
    for o in S['scene'].objects:
        if o.type != 'CAMERA' and o.name not in dyn.objects: o.hide_render = only_eyes or (o is S['sun'] and sh == '12')
    if only_eyes:
        for o in dyn.objects: o.hide_render = not o.get('eye')

def main():
    out = arg('out', '/tmp/hc'); res = arg('res', 960); shots = arg('shots', 'all'); shots = ALL if shots == 'all' else shots.split(',')
    bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
    static = bpy.data.collections.new('static'); dyn = bpy.data.collections.new('dyn'); sc.collection.children.link(static); sc.collection.children.link(dyn)
    make_materials(); build_static(static)
    w = bpy.data.worlds.new('W'); sc.world = w
    try: w.use_nodes = True
    except Exception: pass
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs['Color'].default_value = (0.008, 0.03, 0.15, 1)
    sl = bpy.data.lights.new('sun', 'SUN'); sl.energy = arg('sun', 22.0); sl.color = (0.3, 0.5, 1); sl.angle = R(1.5)
    sun = bpy.data.objects.new('sun', sl); static.objects.link(sun); sun.rotation_mode = 'QUATERNION'
    sun.rotation_quaternion = Vector((-0.22, -1, -0.6)).to_track_quat('-Z', 'Y')
    al = bpy.data.lights.new('fill', 'AREA'); al.shape = 'RECTANGLE'; al.size = 16; al.size_y = 30; al.energy = arg('fill', 500.0); al.color = (0.25, 0.4, 1)
    fill = bpy.data.objects.new('fill', al); static.objects.link(fill); fill.location = (0, 13, 10.2)   # navy ambient so desks/floor read
    cd = bpy.data.cameras.new('cam'); cd.clip_start = 0.05; cd.clip_end = 600; cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
    r = sc.render; r.engine = 'CYCLES'; r.resolution_x = res; r.resolution_y = res * 9 // 16; r.resolution_percentage = 100; r.image_settings.file_format = 'PNG'
    c = sc.cycles; c.samples = arg('samples', 96); c.use_adaptive_sampling = True; c.adaptive_threshold = 0.02; c.use_denoising = True
    c.max_bounces = 6; c.volume_bounces = 0; c.sample_clamp_indirect = 6
    try: c.denoiser = 'OPENIMAGEDENOISE'; c.denoising_use_gpu = True
    except Exception as e: print('denoise', e)
    p = bpy.context.preferences.addons['cycles'].preferences
    for t in ('OPTIX', 'CUDA'):
        try:
            p.compute_device_type = t; p.get_devices()
            if any(d.type == t for d in p.devices):
                for d in p.devices: d.use = d.type == t
                c.device = 'GPU'; print('GPU', t, [d.name for d in p.devices if d.use]); break
        except Exception as e: print('dev', t, e)
    sc.view_settings.view_transform = 'AgX'
    try: sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception as e: print('look', e)
    S = dict(cam=cam, dyn=dyn, sun=sun, scene=sc, bg=bg); os.makedirs(out, exist_ok=True)
    an = arg('anim', '')   # --anim A-B: render global frames A..B-1 as fNNNN.png (11a/b/c panels get a suffix); skips files that exist
    if an:
        global K, T, WHP, DUR
        for n in (map(int, an.split(',')) if ',' in an else range(*map(int, an.split('-')))):   # A-B or a comma list
            sh, f0, f1 = cut.shot(n); K = (n - f0) / (f1 - f0 - 1); T = (n + 1) / 24; t = time.time(); WHP = cut.whip(n); DUR = (f1 - f0) / 24
            for sub in (('11a', '11b', '11c') if sh == '11' else (sh,)):
                fp = f'{out}/f{n:04d}{sub[2:] if sh == "11" else ""}.png'
                if os.path.exists(fp): continue
                for o in list(dyn.objects): bpy.data.objects.remove(o, do_unlink=True)
                setup(sub, S); r.filepath = fp; bpy.ops.render.render(write_still=True)
            for blk in (bpy.data.meshes, bpy.data.curves, bpy.data.lights):
                for d in list(blk):
                    if not d.users: blk.remove(d)
            print(f'FRAME {n} {sh} {time.time() - t:.0f}s', flush=True)
        return
    for sh in shots:
        t = time.time()
        for o in list(dyn.objects): bpy.data.objects.remove(o, do_unlink=True)
        setup(sh, S); r.filepath = f'{out}/shot{sh}.png'; bpy.ops.render.render(write_still=True)
        print(f'SHOT {sh} done {time.time() - t:.0f}s', flush=True)

main()
