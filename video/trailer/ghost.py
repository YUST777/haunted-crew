"""The real Haunted Crew ghost (mod's models/entity/ghost.json + textures/entity/ghost.png) as a Blender rig.

ghost(assets_dir, name, job='coder', coll=None, eye=None) -> root empty.
Each model part becomes an empty (pivot + rotation, parented like the mod's PartDefinitions) with its box mesh child,
so `parts[name]` can be keyframed exactly like setupAnim (body bob, arm xRot). Scale = the mod's 0.5 (1 unit = 1/32 block).
job: planner/coder/tester/reviewer/docs/researcher/guide/None -> which acc_* parts exist.
eye: None = texture eyes; (r,g,b) = glowing eyes (the "turn" shot) via an emissive overlay on the face pixels.
"""
import bpy, bmesh, json, math, os
from mathutils import Matrix, Vector, Euler

S = 1 / 32   # model unit -> metres (blocks)
# model space (x, y down, z; face toward -z) -> blender (x, z, -y): proper rotation, face looks toward -Y
M2B = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))

def _cube_faces(x, y, z, w, h, d, u, v):
    """MC ModelPart.Cube: 6 quads (positions in model space, uv in texture pixels)"""
    X, Y, Z = x + w, y + h, z + d
    v1, v2, v3, v4 = (x, y, z), (X, y, z), (X, Y, z), (x, Y, z)
    v5, v6, v7, v8 = (x, y, Z), (X, y, Z), (X, Y, Z), (x, Y, Z)
    u0, u1, u2, u3, u4, u5 = u, u + d, u + d + w, u + d + w + w, u + d + w + d, u + d + w + d + w
    w0, w1, w2 = v, v + d, v + d + h
    quads = [([v6, v5, v1, v2], u1, w0, u2, w1), ([v3, v4, v8, v7], u2, w1, u3, w0),
             ([v1, v5, v8, v4], u0, w1, u1, w2), ([v2, v1, v4, v3], u1, w1, u2, w2),
             ([v6, v2, v3, v7], u2, w1, u4, w2), ([v5, v6, v7, v8], u4, w1, u5, w2)]
    out = []
    for vs, a, b, c, e in quads:
        out.append((vs, [(c, b), (a, b), (a, e), (c, e)]))   # Polygon remap: v0=(u2,v1) v1=(u1,v1) v2=(u1,v2) v3=(u2,v2)
    return out

_MAT = {}
def ghost_material(assets_dir, tint=(0.89, 0.93, 1.0)):
    key = (assets_dir, tint)
    if key in _MAT: return _MAT[key]
    img = bpy.data.images.load(os.path.join(assets_dir, 'assets/hauntedcrew/textures/entity/ghost.png'), check_existing=True)
    m = bpy.data.materials.new('ghost'); m.use_nodes = True; nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; t.interpolation = 'Closest'
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
    nt.links.new(t.outputs['Color'], mx.inputs[6]); mx.inputs[7].default_value = (*tint, 1)   # mod's status tint (WORKING)
    nt.links.new(mx.outputs[2], b.inputs['Base Color']); nt.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.55
    # ghostly: soft subsurface-ish glow + a little self-light so they read in the dark office
    b.inputs['Emission Strength'].default_value = 0.12; nt.links.new(mx.outputs[2], b.inputs['Emission Color'])
    if 'Subsurface Weight' in b.inputs: b.inputs['Subsurface Weight'].default_value = 0.25
    _MAT[key] = m; return m

def eye_material(rgb, strength=30):
    m = bpy.data.materials.new('ghost_eyes'); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Emission Color'].default_value = (*rgb, 1)
    b.inputs['Emission Strength'].default_value = strength
    return m

def ghost(assets_dir, name, job='coder', coll=None, eye=None):
    coll = coll or bpy.context.scene.collection
    spec = json.load(open(os.path.join(assets_dir, 'assets/hauntedcrew/models/entity/ghost.json')))
    tw, th = spec['texture']
    mat = ghost_material(assets_dir)
    root = bpy.data.objects.new(name, None); coll.objects.link(root); root.empty_display_size = 0.3
    root['job'] = job or ''
    parts = {}
    for p in spec['parts']:
        pn = p['name']
        if pn.startswith('acc_') and (job is None or not pn.startswith(f'acc_{job}_')): continue
        par = parts.get(p['parent']) if p['parent'] else None
        e = bpy.data.objects.new(f'{name}.{pn}', None); coll.objects.link(e); e.empty_display_size = 0.02
        e.parent = par or root
        e.location = M2B @ Vector(p['pivot']) * S
        rx, ry, rz = p['rotation']
        # PartPose rotation (ZYX in model space) conjugated into blender space
        R = M2B @ Euler((rx, ry, rz), 'ZYX').to_matrix() @ M2B.transposed()
        e.rotation_mode = 'QUATERNION'; e.rotation_quaternion = R.to_quaternion()
        e['rest_q'] = list(e.rotation_quaternion)
        bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
        for vs, uvs in _cube_faces(*p['from'], *p['size'], *p['uv']):
            try: f = bm.faces.new([bm.verts.new(M2B @ Vector(c) * S) for c in vs])
            except ValueError: continue
            for l, (u, v) in zip(f.loops, uvs): l[uvl].uv = (u / tw, 1 - v / th)
        me = bpy.data.meshes.new(f'{name}.{pn}'); bm.to_mesh(me); bm.free(); me.materials.append(mat)
        ob = bpy.data.objects.new(f'{name}.{pn}.mesh', me); coll.objects.link(ob); ob.parent = e
        parts[pn] = e
    root['parts'] = list(parts)
    if eye:   # glowing eye plates just in front of the face pixels (face = north quad of body, uv (14..30, 14..28))
        add_eyes(root, parts['body'], eye)
    return root

def add_eyes(root, body, rgb, strength=30):
    """two small emissive plates over the texture's eye pixels (eyes at body-front px ~(5..6, 4..6) and (9..10, 4..6) of 16x14)"""
    m = eye_material(rgb, strength)
    eyes = []
    for cx in (-3.0, 3.0):
        bm = bmesh.new()
        x0, x1 = cx - 1.0, cx + 1.0; y0, y1 = -10.0, -6.0      # texture eye pixels (face px 4-5 / 10-11, rows 4-7), body front z=-7
        pts = [(x1, y0, -7.05), (x0, y0, -7.05), (x0, y1, -7.05), (x1, y1, -7.05)]
        bm.faces.new([bm.verts.new(M2B @ Vector(p) * S) for p in pts])
        me = bpy.data.meshes.new('eye'); bm.to_mesh(me); bm.free(); me.materials.append(m)
        ob = bpy.data.objects.new(root.name + '.eye', me); root.users_collection[0].objects.link(ob); ob.parent = body
        eyes.append(ob)
    return eyes

def part(root, pn):
    return bpy.data.objects.get(f'{root.name}.{pn}')

def key_anim(root, f0, f1, mode='working', phase=0.0, fps=24):
    """bake the mod's setupAnim: body bob sin(t*0.1)*2.4, WORKING arms sin(t*0.6)*0.5 (t in ticks = 20/s)"""
    body, la, ra = part(root, 'body'), part(root, 'left_arm'), part(root, 'right_arm')
    base = body.location.copy()
    for f in range(f0, f1 + 1, 2):
        t = (f / fps) * 20 + phase
        body.location = base + Vector((0, 0, -math.sin(t * 0.1) * 2.4 * S)); body.keyframe_insert('location', frame=f)
        for arm, ang in ((la, math.sin(t * 0.6) * 0.5 if mode == 'working' else 0), (ra, -math.sin(t * 0.6 + 1.5) * 0.5 if mode == 'working' else 0)):
            if arm is None: continue
            q = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0))) @ Euler((ang, 0, 0)).to_matrix() @ Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0))).transposed()
            arm.rotation_quaternion = q.to_quaternion(); arm.keyframe_insert('rotation_quaternion', frame=f)
    body.location = base
