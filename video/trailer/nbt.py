"""Minimal gzip NBT reader (no deps) for Minecraft structure files. load(path) -> dict."""
import gzip, struct

def _payload(f, t):
    if t == 1: return struct.unpack('>b', f.read(1))[0]
    if t == 2: return struct.unpack('>h', f.read(2))[0]
    if t == 3: return struct.unpack('>i', f.read(4))[0]
    if t == 4: return struct.unpack('>q', f.read(8))[0]
    if t == 5: return struct.unpack('>f', f.read(4))[0]
    if t == 6: return struct.unpack('>d', f.read(8))[0]
    if t == 7: n = struct.unpack('>i', f.read(4))[0]; return f.read(n)
    if t == 8: n = struct.unpack('>H', f.read(2))[0]; return f.read(n).decode('utf-8', 'replace')
    if t == 9:
        et = f.read(1)[0]; n = struct.unpack('>i', f.read(4))[0]
        return [_payload(f, et) for _ in range(n)]
    if t == 10:
        d = {}
        while True:
            tt = f.read(1)[0]
            if tt == 0: return d
            k = _payload(f, 8); d[k] = _payload(f, tt)
    if t == 11: n = struct.unpack('>i', f.read(4))[0]; return list(struct.unpack(f'>{n}i', f.read(4 * n)))
    if t == 12: n = struct.unpack('>i', f.read(4))[0]; return list(struct.unpack(f'>{n}q', f.read(8 * n)))
    raise ValueError(f'bad tag {t}')

def load(path):
    with gzip.open(path, 'rb') as f:
        t = f.read(1)[0]; _payload(f, 8); return _payload(f, t)

if __name__ == '__main__':
    import sys, collections
    d = load(sys.argv[1])
    print('size', d['size'], 'blocks', len(d['blocks']), 'entities', len(d.get('entities', [])))
    pal = d.get('palette') or d['palettes'][0]
    c = collections.Counter(b['state'] for b in d['blocks'])
    names = collections.Counter()
    for i, n in c.items(): names[pal[i].get('Name') or pal[i]['id']] += n
    for k, v in names.most_common(): print(v, k)
