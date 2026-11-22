# Turns the Sketchfab "Perfect Steve Revised" model (Blender3D, CC Attribution,
# https://sketchfab.com/3d-models/d2421dd75a3347ca811777852bc5b9c6) into six rigid parts for the
# website's chase section: head, torso, arm_l, arm_r, leg_l, leg_r. Each part's origin sits on its
# joint (neck, shoulders, hips) so the site can animate the run by rotating parts.
#
# 1. Import the model through MCP for Blender:  download_sketchfab_model(uid=d2421dd7..., normalize 2.0)
# 2. python3 tools/hero/bmcp.py tools/hero/build_steve.py
# Output: landing_page/site/public/assets/chase/steve.glb and tools/hero/steve.blend
import bpy
import os
from mathutils import Vector

ROOT = '/home/yousefmsm1/Desktop/kiroween'
OUT = os.path.join(ROOT, 'landing_page/site/public/assets/chase/steve.glb')
PARTS = {'steve_torso': 'torso', 'steve_head': 'head', 'steve_arm_left': 'arm_l',
         'steve_arm_right': 'arm_r', 'steve_leg_left': 'leg_l', 'steve_leg_right': 'leg_r'}
HEIGHT = 2.0  # 32 px tall in Minecraft = 2 units here

sc = bpy.context.scene
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
if arm.animation_data:
    arm.animation_data_clear()
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)
    pb.scale = (1, 1, 1)
bpy.context.view_layer.update()

# Bake each skinned mesh at rest into a plain mesh in world space.
deps = bpy.context.evaluated_depsgraph_get()
baked = {}
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    key = next((v for k, v in PARTS.items() if o.data.name.startswith(k)), None)
    if key is None:
        continue
    me = bpy.data.meshes.new_from_object(o.evaluated_get(deps), depsgraph=deps)
    me.transform(o.matrix_world)
    me.name = 'steve_' + key
    baked[key] = me

# Drop everything that came from the import.
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

# Feet on the ground, centred, scaled to HEIGHT.
verts = [v.co for me in baked.values() for v in me.vertices]
lo = Vector([min(v[i] for v in verts) for i in range(3)])
hi = Vector([max(v[i] for v in verts) for i in range(3)])
s = HEIGHT / (hi.z - lo.z)
shift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
for me in baked.values():
    for v in me.vertices:
        v.co = (v.co - shift) * s

root = bpy.data.objects.new('Steve', None)
sc.collection.objects.link(root)


def bbox(me):
    return (Vector([min(v.co[i] for v in me.vertices) for i in range(3)]),
            Vector([max(v.co[i] for v in me.vertices) for i in range(3)]))


for key, me in baked.items():
    a, b = bbox(me)
    c = (a + b) / 2
    if key == 'head':
        joint = Vector((c.x, c.y, a.z))          # neck: bottom of the head
    elif key == 'torso':
        joint = Vector((c.x, c.y, a.z))          # hips
    elif key.startswith('arm'):
        joint = Vector((c.x, c.y, b.z - (b.x - a.x) / 2))  # shoulder: half an arm-width below the top
    else:
        joint = Vector((c.x, c.y, b.z))          # hip: top of the leg
    for v in me.vertices:
        v.co -= joint
    ob = bpy.data.objects.new(key, me)
    ob.location = joint
    ob.parent = root
    sc.collection.objects.link(ob)

# Pixel-art skin: the source texture is 8192 px; 512 keeps every skin pixel crisp.
for img in bpy.data.images:
    if img.size[0] > 512:
        img.scale(512, 512)

bpy.ops.object.select_all(action='DESELECT')
for o in [root, *root.children]:
    o.select_set(True)
bpy.context.view_layer.objects.active = root
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=False,
                          export_yup=True, export_lights=False, export_cameras=False,
                          export_image_format='WEBP')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'tools/hero/steve.blend'))
print('STEVE', {k: tuple(round(x, 3) for x in bpy.data.objects[k].location) for k in baked}, os.path.getsize(OUT))
