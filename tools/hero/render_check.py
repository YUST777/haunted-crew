# Quick check render of whatever is in the scene, used while modelling through MCP.
# Set CHECK_OUT, CHECK_CAM (location), CHECK_TARGET, CHECK_LENS before exec, or use the defaults.
import bpy
import math
from mathutils import Vector

sc = bpy.context.scene
out = globals().get('CHECK_OUT', '/home/yousefmsm1/Desktop/kiroween/tools/hero/check.png')
cam_loc = Vector(globals().get('CHECK_CAM', (0, -9, 1.3)))
target = Vector(globals().get('CHECK_TARGET', (0, 0, 1.2)))
res = globals().get('CHECK_RES', (1200, 700))

cam = bpy.data.objects.get('CheckCam')
if cam is None:
    cam = bpy.data.objects.new('CheckCam', bpy.data.cameras.new('CheckCam'))
    sc.collection.objects.link(cam)
cam.data.lens = globals().get('CHECK_LENS', 50)
cam.location = cam_loc
cam.rotation_euler = (target - cam_loc).to_track_quat('-Z', 'Y').to_euler()
sc.camera = cam

if bpy.data.objects.get('CheckKey') is None:
    for name, kind, loc, color, energy in (
        ('CheckKey', 'AREA', (3, -6, 5), (0.8, 0.85, 1.0), 1200),
        ('CheckFill', 'POINT', (-4, -3, 0.5), (1.0, 0.6, 0.3), 400),
        ('CheckRim', 'POINT', (0, 4, 3), (0.3, 1.0, 0.9), 500),
    ):
        ld = bpy.data.lights.new(name, kind)
        ld.color, ld.energy = color, energy
        if kind == 'AREA':
            ld.size = 5
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        sc.collection.objects.link(lo)
        lo.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()

if sc.world is None:
    sc.world = bpy.data.worlds.new('World')
bg = next((n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND'), None)
if bg:
    bg.inputs['Color'].default_value = (0.03, 0.04, 0.08, 1)
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = res
sc.render.resolution_percentage = 100
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendered', out)
