"""Haunted Crew trailer, 15 s cold open (16:9, 24 fps, 360 frames), built from the game's real office.nbt + ghost model.

blender -b -P scripts/build.py -- --shot 4 [--still 100] [--res 960] [--samples 64] [--fog 1] [--out DIR] [--save x.blend]
--shot N   build the scene for shot N (1-12, see SHOTS) and render its frames, or one frame with --still F.
Coordinates: Blender (X, Y, Z) = Minecraft (x, -z, y) of office.nbt, 1 block = 1 m.
"""
import bpy, math, os, sys
from mathutils import Vector, Euler

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
PROJ = os.path.dirname(HERE)
import structure, ghost as G

def arg(name, default):
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return type(default)(a[a.index(name) + 1]) if name in a else default

FPS = 24
SHOTS = {  # n: (first, last, name)
    1: (1, 24, 'fade up'), 2: (25, 48, 'establish'), 3: (49, 84, 'push-in'), 4: (85, 120, 'ghost at desk'),
    5: (121, 144, 'typing'), 6: (145, 168, 'the crew'), 7: (169, 192, 'near-black'), 8: (193, 216, 'looks up'),
    9: (217, 252, 'nod'), 10: (253, 288, 'product reveal'), 11: (289, 324, 'montage'), 12: (325, 360, 'title')}
ASSETS = os.path.join(PROJ, 'assets')
ORANGE = (1.0, 0.42, 0.08)
ROW1, ROW2 = -17.15, -23.15                       # ghost Y at the two desk rows (chairs at mc z 17 / 23)
DESK_X = [18.5, 23.5, 33.5, 38.5]
CREW = [('planner', 0, 1), ('coder', 1, 1), ('tester', 2, 1), ('reviewer', 3, 1),
        ('docs', 0, 2), ('researcher', 1, 2), ('coder', 2, 2), ('planner', 3, 2)]
HERO = 1                                           # crew index of the hero ghost (row 1, x 23.5)

def ghost_home(i):
    job, xi, row = CREW[i]
    return Vector((DESK_X[xi], ROW1 if row == 1 else ROW2, 4.6 if row == 1 else 5.6))

# ---------------------------------------------------------------- scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS; sc.frame_start, sc.frame_end = 1, 360
    try: sc.render.engine = 'CYCLES'
    except TypeError: pass
    cy = sc.cycles
    cy.samples = arg('--samples', 64); cy.use_denoising = True
    try: cy.denoiser = 'OPENIMAGEDENOISE'
    except TypeError: pass
    cy.max_bounces = 6; cy.transparent_max_bounces = 16; cy.volume_bounces = 0
    cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.02
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dev in ('OPTIX', 'CUDA', 'HIP', 'METAL'):
        try:
            prefs.compute_device_type = dev; prefs.get_devices()
            if any(d.type == dev for d in prefs.devices):
                for d in prefs.devices: d.use = d.type == dev
                cy.device = 'GPU'; break
        except TypeError: continue
    w = arg('--res', 960); sc.render.resolution_x, sc.render.resolution_y = w, w * 9 // 16
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    try: sc.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError: pass
    sc.render.image_settings.file_format = 'PNG'
    return sc

def world():
    w = bpy.data.worlds.new('night'); bpy.context.scene.world = w; w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.010, 0.017, 0.045, 1); bg.inputs['Strength'].default_value = 1.0

def light(name, kind, loc, color, energy, radius=0.1, coll=None):
    ld = bpy.data.lights.new(name, kind); ld.color = color; ld.energy = energy
    if kind in ('POINT', 'SPOT'): ld.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, ld); ob.location = loc
    (coll or bpy.context.scene.collection).objects.link(ob); return ob

def moon(fog):
    """moonlight through the east-wall windows (mc x=44, y 7-11, z 14-29) + a visible moon outside"""
    d = Vector((-0.78, -0.12, -0.6)).normalized()
    sun = light('moon', 'SUN', (60, -20, 20), (0.42, 0.58, 1.0), 4.5)
    sun.rotation_euler = (-d).to_track_quat('Z', 'Y').to_euler(); sun.data.angle = math.radians(1.5)
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=3.2, fill_type='NGON', location=(85, -20, 26))
    m = bpy.context.object; m.name = 'moon_disc'; m.rotation_euler = (0, math.radians(90), 0)
    mat = bpy.data.materials.new('moon'); mat.use_nodes = True
    b = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Emission Color'].default_value = (0.75, 0.85, 1.0, 1); b.inputs['Emission Strength'].default_value = 6
    m.data.materials.append(mat); m.visible_shadow = False
    if fog:   # thin haze inside the office so the moonbeams and lanterns read
        bpy.ops.mesh.primitive_cube_add(location=(28.5, -20, 8)); v = bpy.context.object; v.name = 'haze'
        v.scale = (17, 13, 5.5)
        vm = bpy.data.materials.new('haze'); vm.use_nodes = True; nt = vm.node_tree
        for n in list(nt.nodes):
            if n.type == 'BSDF_PRINCIPLED': nt.nodes.remove(n)
        pv = nt.nodes.new('ShaderNodeVolumePrincipled'); pv.inputs['Density'].default_value = 0.035
        pv.inputs['Color'].default_value = (0.6, 0.7, 1.0, 1)
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'); nt.links.new(pv.outputs[0], out.inputs['Volume'])
        v.data.materials.append(vm); v.visible_shadow = False

def office():
    remap = {'minecraft:soul_lantern': 'minecraft:lantern'}   # storyboard: warm orange lanterns
    ob, info = structure.build(os.path.join(PROJ, 'office.nbt'), ASSETS, remap=remap)
    coll = bpy.data.collections.new('lamps'); bpy.context.scene.collection.children.link(coll)
    for name, p, props in info['lights']:
        if 'candle' in name:
            n = int(props.get('candles', 1)); light('candle', 'POINT', p + Vector((0, 0, 0.1)), ORANGE, 2.5 * n, 0.05, coll)
        elif 'jack' in name: light('jack', 'POINT', p, ORANGE, 25, 0.3, coll)
        elif 'campfire' in name or 'fire' in name: light('fire', 'POINT', p, ORANGE, 40, 0.3, coll)
        else: light('lantern', 'POINT', p - Vector((0, 0, 0.1)), ORANGE, 18, 0.12, coll)
    for (x, y, z), n in info['blocks'].items():   # monitor glow onto the ghost faces
        if n == 'monitor': light('screen', 'AREA', (x + 0.5, -(z + 0.5) - 0.35, y + 0.55), (0.45, 0.7, 1.0), 4, coll=coll).data.size = 0.6
    for l in coll.objects:
        if l.name.startswith('screen'): l.rotation_euler = (math.radians(90), 0, 0)   # area faces -Y (toward the ghost)
    return ob, info, coll

def dashboard(seq_frame=None):
    """emissive plane over the black-concrete big screen (mc x 21-35, y 5-11, z 7 south face)"""
    bpy.ops.mesh.primitive_plane_add(size=1, location=(28.5, -8.02, 8.5)); p = bpy.context.object; p.name = 'dashboard'
    p.rotation_euler = (math.radians(90), 0, 0); p.scale = (15, 7, 1)
    m = bpy.data.materials.new('dashboard'); m.use_nodes = True; nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    t = nt.nodes.new('ShaderNodeTexImage'); t.interpolation = 'Closest'
    ui_dir = os.path.join(PROJ, 'ui')
    if seq_frame is None: t.image = bpy.data.images.load(os.path.join(ui_dir, 'idle.png'))
    else:
        t.image = bpy.data.images.load(os.path.join(ui_dir, 'screen_0001.png')); t.image.source = 'SEQUENCE'
        t.image_user.frame_duration = 48; t.image_user.frame_start = seq_frame; t.image_user.use_auto_refresh = True
    nt.links.new(t.outputs['Color'], b.inputs['Base Color']); nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 1.6; b.inputs['Roughness'].default_value = 0.3
    p.data.materials.append(m)
    light('dash_glow', 'AREA', (28.5, -8.6, 8.5), (0.6, 0.55, 1.0), 120).data.size = 12
    bpy.data.objects['dash_glow'].rotation_euler = (math.radians(-90), 0, 0)
    return p

def crew():
    coll = bpy.data.collections.new('crew'); bpy.context.scene.collection.children.link(coll)
    gs = []
    for i, (job, xi, row) in enumerate(CREW):
        g = G.ghost(ASSETS, f'ghost{i}', job, coll)
        g.location = ghost_home(i); g.rotation_euler = (0, 0, math.pi)   # face the monitor (mc north)
        g['eyes'] = [e.name for e in G.add_eyes(g, G.part(g, 'body'), ORANGE, 0)]
        G.key_anim(g, 1, 360, 'working', phase=i * 7.3)
        gs.append(g)
    return gs

def eyes_glow(g, f, s):
    for en in g['eyes']:
        b = next(n for n in bpy.data.objects[en].active_material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        b.inputs['Emission Strength'].default_value = s; b.inputs['Emission Strength'].keyframe_insert('default_value', frame=f)

def camera(loc, target, lens=35, f=None, fstop=None, focus=None):
    sc = bpy.context.scene
    cam = sc.camera
    if cam is None:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
        cam.data.sensor_width = 36
    cam.location = loc; cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    if fstop: cam.data.dof.use_dof = True; cam.data.dof.aperture_fstop = fstop; cam.data.dof.focus_distance = focus or (Vector(target) - Vector(loc)).length
    if f is not None:
        for p in ('location', 'rotation_euler'): cam.keyframe_insert(p, frame=f)
        cam.data.keyframe_insert('lens', frame=f)
        if fstop: cam.data.dof.keyframe_insert('focus_distance', frame=f)
    return cam

def linear(ob):
    ad = ob.animation_data
    if ad and ad.action:
        try: fcs = ad.action.fcurves
        except AttributeError: fcs = [fc for l in ad.action.layers for s in l.strips for cb in s.channelbags for fc in cb.fcurves]
        for fc in fcs:
            for k in fc.keyframe_points: k.interpolation = 'BEZIER'; k.easing = 'EASE_IN_OUT'

# ---------------------------------------------------------------- logo
FONT = os.path.join(PROJ, '../../shared/fonts/minecraft/Minecraft.ttf')

def logo(origin, px=0.22, depth=3, coll=None):
    """'HAUNTED' / 'CREW' as voxel blocks from the Minecraft font bitmap, orange terracotta + glowing face"""
    from PIL import Image, ImageDraw, ImageFont
    coll = coll or bpy.context.scene.collection
    font = ImageFont.truetype(FONT, 16)
    import bmesh
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    for li, word in enumerate(('HAUNTED', 'CREW')):
        im = Image.new('L', (200, 24), 0); ImageDraw.Draw(im).text((2, 2), word, font=font, fill=255)
        bb = im.getbbox(); im = im.crop(bb); im = im.resize((im.width // 2, im.height // 2), Image.NEAREST)
        sc = 1.0 if li == 0 else 1.25
        W = im.width * px * sc
        for y in range(im.height):
            for x in range(im.width):
                if im.getpixel((x, y)) < 128: continue
                x0 = origin[0] - W / 2 + x * px * sc; z0 = origin[2] - (y + 1) * px * sc - li * 2.4 * px * im.height * 0.62
                s = px * sc; dd = depth * px
                vs = [(x0, origin[1], z0), (x0 + s, origin[1], z0), (x0 + s, origin[1], z0 + s), (x0, origin[1], z0 + s)]
                c = [Vector(v) for v in vs] + [Vector(v) + Vector((0, dd, 0)) for v in vs]
                for q in ((0, 1, 2, 3), (5, 4, 7, 6), (3, 2, 6, 7), (4, 5, 1, 0), (4, 0, 3, 7), (1, 5, 6, 2)):
                    f = bm.faces.new([bm.verts.new(c[i]) for i in q])
                    for l, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))): l[uvl].uv = uv
    me = bpy.data.meshes.new('logo'); bm.to_mesh(me); bm.free()
    m = bpy.data.materials.new('logo'); m.use_nodes = True; nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    t = nt.nodes.new('ShaderNodeTexImage'); t.interpolation = 'Closest'
    t.image = bpy.data.images.load(os.path.join(ASSETS, 'assets/minecraft/textures/block/orange_terracotta.png'))
    nt.links.new(t.outputs['Color'], b.inputs['Base Color']); nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 0.35; b.inputs['Roughness'].default_value = 0.6
    me.materials.append(m)
    ob = bpy.data.objects.new('logo', me); coll.objects.link(ob); me.polygons.foreach_set('use_smooth', [False] * len(me.polygons))
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.remove_doubles(threshold=1e-4); bpy.ops.object.mode_set(mode='OBJECT')
    return ob

def tagline(loc, text='Your Kiro agents, haunting Minecraft.', size=0.42):
    cu = bpy.data.curves.new('tag', 'FONT'); cu.body = text; cu.align_x = 'CENTER'; cu.size = size
    cu.font = bpy.data.fonts.load(FONT)
    ob = bpy.data.objects.new('tagline', cu); bpy.context.scene.collection.objects.link(ob)
    ob.location = loc; ob.rotation_euler = (math.radians(90), 0, 0)
    m = bpy.data.materials.new('tag'); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (1, 1, 1, 1); b.inputs['Emission Color'].default_value = (1, 0.93, 0.8, 1)
    b.inputs['Emission Strength'].default_value = 2.5; cu.materials.append(m)
    return ob

# ---------------------------------------------------------------- shots
def lamps_scale(coll, k, f):
    for l in coll.objects:
        if 'base' not in l: l['base'] = l.data.energy
        l.data.energy = l['base'] * k; l.data.keyframe_insert('energy', frame=f)

def shot(n, S):
    sc = bpy.context.scene; f0, f1, _ = SHOTS[n]
    gs, lamps = S['crew'], S['lamps']
    hero = gs[HERO]; hp = ghost_home(HERO)
    if n == 1:
        sc.view_settings.exposure = -9; sc.view_settings.keyframe_insert('exposure', frame=f0)
        sc.view_settings.exposure = 0; sc.view_settings.keyframe_insert('exposure', frame=f1 - 2)
        camera((27.4, -30.4, 3.75), (28.8, -12, 5.2), 24, f0, 2.0, 15)
        camera((27.5, -30.0, 3.8), (28.8, -12, 5.2), 24, f1, 2.0, 15)
    elif n == 2:
        camera((15.6, -29.8, 8.4), (36.5, -14, 6.2), 18, f0, 4.0)
        camera((16.4, -29.4, 8.2), (36.5, -13.5, 6.2), 18, f1, 4.0)
    elif n == 3:
        camera((28.5, -30.5, 5.0), (28.5, -10, 5.4), 28, f0)
        camera((28.5, -24.8, 4.9), (28.5, -10, 5.1), 28, f1)
    elif n == 4:
        camera((26.1, -15.4, 4.95), hp + Vector((0, 0, -0.1)), 40, f0, 2.0)
        camera((25.6, -15.6, 4.85), hp + Vector((0, 0, -0.12)), 42, f1, 2.0)
    elif n == 5:
        k = Vector((hp.x, -16.85, 4.05))
        camera(k + Vector((0.55, 0.45, 0.32)), k + Vector((0, -0.12, 0.05)), 50, f0, 1.4)
        camera(k + Vector((0.5, 0.42, 0.3)), k + Vector((0, -0.12, 0.05)), 52, f1, 1.4)
    elif n == 6:
        camera((28.5, -11.2, 6.4), (28.5, -20.5, 4.6), 22, f0, 4.0)
        camera((28.5, -11.8, 6.2), (28.5, -20.5, 4.6), 22, f1, 4.0)
    elif n in (7, 8, 9):
        cam_close = (hp.x, -15.55, 4.75)
        if n == 7:
            lamps_scale(lamps, 0.0, f0)
            for o in ('moon', 'dash_glow'):
                if o in bpy.data.objects: bpy.data.objects[o].data.energy = 0
            sc.view_settings.exposure = -1.5
            camera(cam_close, hp + Vector((0, 0, -0.1)), 55, f0, 2.0)
            eyes_glow(hero, f0 + 8, 0); eyes_glow(hero, f0 + 14, 40)
        elif n == 8:
            lamps_scale(lamps, 0.35, f0)
            rim = light('rim', 'AREA', hp + Vector((0.8, -0.9, 0.9)), ORANGE, 30); rim.data.size = 1.0
            rim.rotation_euler = (hp - rim.location).to_track_quat('-Z', 'Y').to_euler()
            eyes_glow(hero, f0, 40)
            hero.rotation_mode = 'XYZ'
            hero.rotation_euler = (math.radians(-18), 0, math.pi); hero.keyframe_insert('rotation_euler', frame=f0 + 2)
            hero.rotation_euler = (math.radians(8), 0, math.pi); hero.keyframe_insert('rotation_euler', frame=f0 + 14)
            camera(cam_close, hp + Vector((0, 0, -0.08)), 55, f0, 2.0)
            camera((hp.x, -15.65, 4.72), hp + Vector((0, 0, -0.06)), 58, f1, 2.0)
        else:
            lamps_scale(lamps, 0.5, f0)
            eyes_glow(hero, f0, 40)
            hero.rotation_mode = 'XYZ'
            for df, a in ((0, 8), (6, -14), (11, 6), (16, 0)):
                hero.rotation_euler = (math.radians(a), 0, math.pi); hero.keyframe_insert('rotation_euler', frame=f0 + df)
            for i, g in enumerate(gs):     # the crew answers: eyes light up one by one
                if g is hero: continue
                eyes_glow(g, f0 + 12 + i * 2, 0); eyes_glow(g, f0 + 15 + i * 2, 30)
            camera((hp.x + 1.6, -15.3, 5.0), (hp.x + 0.2, -20, 4.8), 30, f0, 2.8, 2.2)
            camera((hp.x + 1.5, -15.5, 4.95), (hp.x + 0.3, -20, 4.8), 30, f1, 2.8, 2.2)
    elif n == 10:
        for g in gs: eyes_glow(g, f0, 30)
        camera((28.5, -20.5, 6.0), (28.5, -8, 8.2), 26, f0, 4.0)
        camera((28.5, -14.8, 7.0), (28.5, -8, 8.4), 26, f1, 4.0)
    elif n == 11:
        # three 12-frame cuts: planner, coder, tester at their desks (front, over the monitor)
        cam = None
        for k, i in enumerate((0, 1, 2)):
            p = ghost_home(i); fa = f0 + k * 12
            cam = camera((p.x + 0.35, -15.6, 4.8), p + Vector((0, 0, -0.08)), 45, fa, 2.0)
            cam = camera((p.x + 0.25, -15.75, 4.78), p + Vector((0, 0, -0.08)), 48, fa + 11, 2.0)
    elif n == 12:
        lamps_scale(lamps, 0.6, f0)
        lg = logo((28.5, -12.0, 9.6)); tagline((28.5, -12.1, 5.9))
        key = light('title_key', 'AREA', (28.5, -16, 11), ORANGE, 400); key.data.size = 6
        key.rotation_euler = (Vector((28.5, -12, 8)) - key.location).to_track_quat('-Z', 'Y').to_euler()
        camera((28.5, -21.5, 7.6), (28.5, -12, 7.9), 32, f0, 5.6)
        camera((28.5, -20.8, 7.6), (28.5, -12, 7.9), 32, f1, 5.6)
    return f0, f1

def main():
    n = arg('--shot', 1); still = arg('--still', 0)
    sc = reset(); world()
    fog = arg('--fog', 1)
    moon(fog)
    ob, info, lamps = office()
    dashboard(seq_frame=SHOTS[10][0] if n == 10 else None)
    S = {'crew': crew(), 'lamps': lamps}
    f0, f1 = shot(n, S)
    if sc.camera and sc.camera.animation_data: linear(sc.camera)
    out = arg('--out', os.path.join(PROJ, '../output/13_haunted_crew'))
    os.makedirs(out, exist_ok=True)
    save = arg('--save', '')
    if save: bpy.ops.wm.save_as_mainfile(filepath=save)
    if still:
        sc.frame_set(still); sc.render.filepath = os.path.join(out, f'shot{n:02d}_f{still:03d}.png')
        bpy.ops.render.render(write_still=True)
    elif arg('--anim', 0):
        sc.frame_start, sc.frame_end = f0, f1; sc.render.filepath = os.path.join(out, 'frames', 'f')
        bpy.ops.render.render(animation=True)

if __name__ == '__main__':
    main()
