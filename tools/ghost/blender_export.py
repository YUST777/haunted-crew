# Run inside Blender (Text Editor or MCP): dumps the boxes in the "HauntedGhost" collection to
# a JSON file. Ghost: export(path) then paint_ghost.py. Monitor: export(path, 'Monitor') then
# tools/monitor/make_monitor.py.
#
# Modelling rules: every object is one axis-aligned box, 1 Blender unit = 1/32 block,
# front faces -Y, ground at Z=0. Rotate at most one axis per object. Parents must not be rotated.
# Accessories are named acc_<job>_<anything>; the mod shows only the agent's job.
import bpy
import json
import math
import os

OUT = os.path.join(os.path.dirname(bpy.path.abspath(__file__)) if '__file__' in dir() else '', 'ghost_parts.json')


def world_pivot(o):
    p = o.location.copy()
    q = o.parent
    while q is not None:
        p += q.location
        q = q.parent
    return p


def export(path, collection='HauntedGhost'):
    parts = []
    for o in bpy.data.collections[collection].objects:
        if o.type != 'MESH':
            continue
        xs = [v.co.x for v in o.data.vertices]
        ys = [v.co.y for v in o.data.vertices]
        zs = [v.co.z for v in o.data.vertices]
        if o.parent is not None and any(abs(a) > 1e-6 for a in o.parent.rotation_euler):
            raise ValueError(f'{o.name}: parent {o.parent.name} is rotated')
        parts.append({
            'name': o.name,
            'parent': o.parent.name if o.parent else None,
            'pivot': list(world_pivot(o)),
            'rotation_deg': [math.degrees(a) for a in o.rotation_euler],
            'min': [min(xs), min(ys), min(zs)],
            'size': [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)],
            'color': o.get('hc_color', 'FF00FF'),
        })
    with open(path, 'w') as f:
        json.dump({'unit': 'blender units = 1/32 block', 'parts': parts}, f, indent=1)
    return len(parts)
