"""Build a Minecraft structure (.nbt) in Blender from real blockstates/models/textures.

build(nbt_path, assets_dir, remap=None, coll=None) -> (mesh object, info)
assets_dir holds assets/<namespace>/{blockstates,models,textures}. MC (x, y, z) -> Blender (x, -z, y), 1 block = 1 m.
info: {'lights': [(name, Vector pos, state props)], 'blocks': {(x,y,z): name}}.
shortcut: block entities (banners, skulls, chests, signs) and uvlock are skipped; fine for a dark trailer, add if a shot shows them.
"""
import bpy, bmesh, json, math, os
from mathutils import Matrix, Vector, Euler
import nbt

TRANSPARENT = ('glass', 'leaves', 'ice', 'slime', 'honey', 'barrier', 'spawner', 'light')
EMIT = {  # texture -> (strength, colour tint or None = texture colour)
    'block/sea_lantern': (0.5, (0.55, 0.75, 1.0)), 'block/lantern': (2.5, None), 'block/soul_lantern': (2.5, None),
    'block/jack_o_lantern': (4, None), 'block/campfire_fire': (6, None), 'block/soul_campfire_fire': (6, None),
    'block/soul_fire_0': (6, None), 'block/amethyst_cluster': (0.5, None), 'hauntedcrew:block/monitor': (3, None)}
SKIP = {'air', 'cave_air', 'void_air', 'structure_block', 'light', 'barrier', 'structure_void', 'jigsaw'}
FOLIAGE = (0.30, 0.42, 0.22)   # dark swampy tint for tintindex faces (fern, grass)

def _ns(ref):
    ns, p = (ref.split(':', 1) if ':' in ref else ('minecraft', ref))
    return ns, p

class Assets:
    def __init__(self, root):
        self.root, self._json = root, {}
    def json(self, kind, ref):
        ns, p = _ns(ref); k = (kind, ns, p)
        if k not in self._json:
            fp = os.path.join(self.root, 'assets', ns, kind, p + '.json')
            self._json[k] = json.load(open(fp)) if os.path.exists(fp) else None
        return self._json[k]
    def model(self, ref):
        """-> (elements, textures, ao) with parent chain merged"""
        tex, els, cur = {}, None, ref
        for _ in range(12):
            d = self.json('models', cur)
            if d is None: break
            for k, v in d.get('textures', {}).items(): tex.setdefault(k, v)
            if els is None and 'elements' in d: els = d['elements']
            if 'parent' not in d: break
            cur = d['parent']
        def r(v, n=0):
            if isinstance(v, dict): v = v.get('sprite', '')   # 26.x texture refs can be {"sprite": ...}
            while isinstance(v, str) and v.startswith('#') and n < 8:
                v = tex.get(v[1:], ''); n += 1
                if isinstance(v, dict): v = v.get('sprite', '')
            return v
        return els or [], {k: r(v) for k, v in tex.items()}

def _match_when(w, props):
    if 'OR' in w: return any(_match_when(x, props) for x in w['OR'])
    if 'AND' in w: return all(_match_when(x, props) for x in w['AND'])
    for k, v in w.items():
        neg = str(v).startswith('!')
        ok = props.get(k) in str(v).lstrip('!').split('|')
        if ok == neg: return False
    return True

def variants(A, name, props):
    """-> list of (model, x, y) for a block state"""
    bs = A.json('blockstates', name)
    if bs is None: return []
    pick = lambda v: v[0] if isinstance(v, list) else v
    out = []
    if 'variants' in bs:
        for key, v in bs['variants'].items():
            if all(props.get(a) == b for a, b in (kv.split('=') for kv in key.split(',') if kv)):
                out.append(pick(v)); break
    for part in bs.get('multipart', []):
        if 'when' not in part or _match_when(part['when'], props): out.append(pick(part['apply']))
    return [(v['model'], v.get('x', 0), v.get('y', 0)) for v in out]

DIRS = {'north': (0, 0, -1), 'south': (0, 0, 1), 'east': (1, 0, 0), 'west': (-1, 0, 0), 'up': (0, 1, 0), 'down': (0, -1, 0)}

def _material(A, ref, cache):
    if ref in cache: return cache[ref]
    ns, p = _ns(ref)
    fp = os.path.join(A.root, 'assets', ns, 'textures', p + '.png')
    if not os.path.exists(fp): cache[ref] = None; return None
    img = bpy.data.images.load(fp, check_existing=True)
    if img.size[1] > img.size[0]:   # animated strip: keep first frame via mapping scale
        pass
    m = bpy.data.materials.new('mc_' + p.split('/')[-1]); nt = m.node_tree if m.use_nodes else None
    m.use_nodes = True; nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; t.interpolation = 'Closest'
    if img.size[1] > img.size[0]:   # animated strip -> show frame 0
        mp = nt.nodes.new('ShaderNodeMapping'); tc = nt.nodes.new('ShaderNodeTexCoord')
        mp.inputs['Scale'].default_value = (1, img.size[0] / img.size[1], 1)
        mp.inputs['Location'].default_value = (0, 1 - img.size[0] / img.size[1], 0)
        nt.links.new(tc.outputs['UV'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
    col = t.outputs['Color']
    if p in ('block/fern', 'block/short_grass', 'block/tall_grass_top', 'block/tall_grass_bottom', 'block/large_fern_top', 'block/large_fern_bottom'):
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'
        mx.inputs['Factor'].default_value = 1; nt.links.new(col, mx.inputs[6]); mx.inputs[7].default_value = (*FOLIAGE, 1)
        col = mx.outputs[2]
    nt.links.new(col, b.inputs['Base Color']); nt.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.8; b.inputs['Specular IOR Level'].default_value = 0.3
    key = p if ns == 'minecraft' else ref
    if key in EMIT:
        s, c = EMIT[key]
        b.inputs['Emission Strength'].default_value = s
        if c: b.inputs['Emission Color'].default_value = (*c, 1)
        else: nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
    m['mc_tex'] = ref
    cache[ref] = m; return m

def _is_full(els):
    return len(els) == 1 and els[0]['from'] == [0, 0, 0] and els[0]['to'] == [16, 16, 16] and 'rotation' not in els[0]

def build(nbt_path, assets_dir, remap=None, coll=None, crop=None, name='office'):
    """crop: ((x0,y0,z0),(x1,y1,z1)) inclusive MC bounds to keep"""
    A = Assets(assets_dir); d = nbt.load(nbt_path)
    pal = d.get('palette') or d['palettes'][0]
    states = []
    for p in pal:
        n = (p.get('Name') or p['id']); props = dict(p.get('Properties') or p.get('properties') or {})
        n = (remap or {}).get(n, n)
        states.append((n, props))
    grid = {}
    for b in d['blocks']:
        n, props = states[b['state']]
        if n.split(':')[-1] in SKIP: continue
        x, y, z = b['pos']
        if crop and not all(crop[0][i] <= b['pos'][i] <= crop[1][i] for i in range(3)): continue
        grid[(x, y, z)] = b['state']
    # resolve models per palette state once
    smodels, opaque = {}, set()
    for si in set(grid.values()):
        n, props = states[si]
        ms = [(A.model(m), x, y) for m, x, y in variants(A, n, props)]
        smodels[si] = ms
        if len(ms) == 1 and _is_full(ms[0][0][0]) and not any(t in n for t in TRANSPARENT): opaque.add(si)
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap'); mats, cache = [], {}
    lights = []
    for (x, y, z), si in grid.items():
        n, props = states[si]
        short = n.split(':')[-1]
        if any(k in short for k in ('lantern', 'candle', 'campfire', 'soul_fire', 'jack_o')) and props.get('lit', 'true') == 'true':
            lights.append((short, Vector((x + 0.5, -(z + 0.5), y + 0.5)), props))
        for (els, tex), rx, ry in smodels[si]:
            Rm = Euler((0, math.radians(-ry), 0)).to_matrix() @ Euler((math.radians(-rx), 0, 0)).to_matrix()   # Ry(-y) Rx(-x)
            R = Matrix.Translation((8, 8, 8)) @ Rm.to_4x4() @ Matrix.Translation((-8, -8, -8))
            for el in els:
                f0, t0 = el['from'], el['to']
                ER = Matrix.Identity(4)
                if 'rotation' in el:
                    ro = el['rotation']; o = Vector(ro.get('origin', (8, 8, 8)))
                    if 'axis' in ro:
                        ang = math.radians(ro.get('angle', 0)); ER = Matrix.Rotation(ang, 4, ro['axis'].upper())
                        if ro.get('rescale'):
                            s = 1 / math.cos(abs(ang)); sv = [s if a != ro['axis'] else 1 for a in 'xyz']
                            ER = ER @ Matrix.Diagonal((*sv, 1))
                    else:
                        ER = Euler([math.radians(ro.get(k, 0)) for k in 'xyz'], 'XYZ').to_matrix().to_4x4()
                    ER = Matrix.Translation(o) @ ER @ Matrix.Translation(-o)
                fx, fy, fz = f0; tx, ty, tz = t0
                C = {'north': [(tx, ty, fz), (fx, ty, fz), (fx, fy, fz), (tx, fy, fz)], 'south': [(fx, ty, tz), (tx, ty, tz), (tx, fy, tz), (fx, fy, tz)],
                     'east': [(tx, ty, tz), (tx, ty, fz), (tx, fy, fz), (tx, fy, tz)], 'west': [(fx, ty, fz), (fx, ty, tz), (fx, fy, tz), (fx, fy, fz)],
                     'up': [(fx, ty, fz), (tx, ty, fz), (tx, ty, tz), (fx, ty, tz)], 'down': [(fx, fy, tz), (tx, fy, tz), (tx, fy, fz), (fx, fy, fz)]}
                AUTO = {'north': (16 - tx, 16 - ty, 16 - fx, 16 - fy), 'south': (fx, 16 - ty, tx, 16 - fy), 'east': (16 - tz, 16 - ty, 16 - fz, 16 - fy),
                        'west': (fz, 16 - ty, tz, 16 - fy), 'up': (fx, fz, tx, tz), 'down': (fx, 16 - tz, tx, 16 - fz)}
                for face, fd in el.get('faces', {}).items():
                    if 'cullface' in fd:
                        dv = Rm @ Vector(DIRS[fd['cullface']])
                        nb = grid.get((x + round(dv.x), y + round(dv.y), z + round(dv.z)))
                        if nb is not None and (nb in opaque or (nb == si and any(t in n for t in TRANSPARENT))): continue
                    m = _material(A, tex.get(fd.get('texture', '').lstrip('#'), fd.get('texture', '')), cache)
                    if m is None: continue
                    if m not in mats: mats.append(m)
                    pts = [(R @ ER @ Vector(p).to_4d()).xyz / 16 for p in C[face]]
                    pts = [Vector((x + p.x, -(z + p.z), y + p.y)) for p in pts]
                    if (pts[1] - pts[0]).cross(pts[3] - pts[0]).length < 1e-9: continue
                    u1, v1, u2, v2 = fd.get('uv', AUTO[face])
                    uv = [(u1, v1), (u2, v1), (u2, v2), (u1, v2)]
                    k = (fd.get('rotation', 0) // 90) % 4
                    uv = uv[k:] + uv[:k]
                    try: f = bm.faces.new([bm.verts.new(p) for p in pts])
                    except ValueError: continue
                    f.material_index = mats.index(m)
                    for l, (u, v) in zip(f.loops, uv): l[uvl].uv = (u / 16, 1 - v / 16)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    ob = bpy.data.objects.new(name, me); (coll or bpy.context.scene.collection).objects.link(ob)
    blocks = {k: states[v][0].split(':')[-1] for k, v in grid.items()}
    return ob, {'lights': lights, 'blocks': blocks, 'states': {k: states[v] for k, v in grid.items()}, 'size': d['size']}
