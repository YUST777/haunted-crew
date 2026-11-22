"""Kiroween demo video (under 3 min): the trailer, then the owner's screen recordings cut on word timings, captions burned in.
python3 submission.py REC_DIR TR_JSON TRAILER SLIME FONT_DIR OUT.mp4 [--plan]
REC_DIR: rec1.mp4 (walkthrough), rec2.mp4 (workflow graph take), rec3.mp4 (workflow pitch take). TR_JSON: Whisper words per file.
--plan prints the timeline and captions without rendering."""
import json, os, subprocess, sys
REC, TR, TRAILER, SLIME, FONTS, OUT = sys.argv[1:7]; PLAN = '--plan' in sys.argv
WORDS = {int(k): [w for s in v for w in s['w']] for k, v in json.load(open(TR)).items()}
SRC = lambda f: f'{REC}/rec{f}.mp4'
TR0 = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', TRAILER], capture_output=True, text=True).stdout)
XF = [('zoomin', .6), ('smoothleft', .4), ('smoothleft', .4)]   # trailer>B, B>C, C>D

# takes kept: (file, start s, end s) cut on word boundaries from tr.json
B = [(1, 5.4, 7.95), (1, 7.95, 10.15), (1, 11.72, 22.2), (1, 23.95, 31.9), (1, 36.1, 39.55), (1, 42.95, 45.95), (1, 62.4, 69.55),
     (1, 73.5, 81.45), (1, 86.4, 97.7), (1, 98.95, 103.62), (1, 147.5, 151.0), (1, 153.0, 158.3), (1, 159.6, 164.4)]
C = [(3, 4.75, 11.85), (3, 12.2, 18.6), (3, 18.7, 23.35), (3, 29.05, 34.4), (3, 34.5, 37.15), (3, 38.05, 43.25), (3, 53.4, 57.6), (3, 61.05, 70.2), (3, 70.25, 85.4)]
D = [(3, 87.15, 91.1), (3, 97.9, 99.95), (3, 99.95, 101.15), (3, 102.55, 109.5), (3, 109.55, 116.9), (3, 121.7, 123.95), (3, 124.8, 126.45)]
# section D pictures: from this source word time on (file 3), show (input, start s)
DVIS = [(0, (1, 6.0)),   # rec1 starts on the OBS window; landing page from ~3 s
         (97.9, (1, 63.0)), (100.5, (1, 91.0)), (102.6, ('trailer', 4.0)), (104.3, ('slime', 2.0)),
        (109.55, (2, 108.0)), (124.8, ('trailer', TR0 - 3.2))]
FIX = {'kiru': 'Kiro', "kiru's": "Kiro's", 'oppos': 'Opus', 'hikos': 'Haiku', 'mcbs': 'MCPs', 'coagent': 'agent', 'high': 'Haiku', 'decoder': 'the coder',
       'viewer': 'reviewer', 'docks': 'docs', 'award': 'world', 'comment': 'command', '24p': '240p', '250p': '240p', 'collab': 'Colab', 'a': 'a', 't4': 'T4',
       'chargedvt': 'ChatGPT', 'frankstein': 'Frankenstein', 'an': 'a'}
KEEP = {'I', 'Kiro', "Kiro's", 'Minecraft', 'Haunted', 'Crew', 'Frankenstein', 'Opus', 'Haiku', 'YouTube', 'Reddit', 'GitHub', 'Twitter', 'Google', 'Colab', 'Instagram', 'Blender', 'ChatGPT'}

def pieces(takes):
    """split each take at pauses > 0.35 s so dead air is cut; returns [(file, a, b, words)]"""
    out = []
    for f, a, b in takes:
        ws = [w for w in WORDS[f] if a - .05 <= w[0] < b]; s = a
        for w0, w1 in zip(ws, ws[1:]):
            if w1[0] - w0[1] > .35: out.append((f, s, w0[1] + .15)); s = w1[0] - .12
        out.append((f, s, b))
    return [(f, a, b, [w for w in WORDS[f] if a - .05 <= w[0] < b]) for f, a, b in out if b - a > .1]

def run(args):
    if PLAN or (args[-1] != OUT and os.path.exists(args[-1])): return   # section already rendered: resume at the join
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *args], check=True)

TAIL = 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p,setsar=1'
def VF(f, t):   # crop off the window chrome (measured on the 2560x1600 recordings): browser tabs/URL bar or the Minecraft title bar
    return ('crop=2400:1350:80:250,' if f == 1 and t < 86 else 'crop=2560:1440:0:158,') + TAIL
ENC = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k']
VOICE = 'highpass=f=80,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000'

def audio(ps):
    """inputs + filter that concatenates the pieces' audio into [a] (15 ms fades so the joins don't click)"""
    inp, fc = [], []
    for i, (f, a, b, _) in enumerate(ps):
        inp += ['-ss', f'{a:.3f}', '-t', f'{b - a:.3f}', '-i', SRC(f)]
        fc.append(f'[{i}:a]asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st={b - a - .015:.3f}:d=0.015[a{i}]')
    fc.append(''.join(f'[a{i}]' for i in range(len(ps))) + f'concat=n={len(ps)}:v=0:a=1,{VOICE}[a]')
    return inp, fc

def section(name, takes):
    ps = pieces(takes); L = sum(b - a for _, a, b, _ in ps); inp, fc = audio(ps); n = len(ps)
    if name == 'B':   # walkthrough: picture follows the voice (jump cuts)
        fc += [f'[{i}:v]setpts=PTS-STARTPTS,{VF(f, a)}[v{i}]' for i, (f, a, _, _) in enumerate(ps)] + [''.join(f'[v{i}]' for i in range(n)) + f'concat=n={n}:v=1:a=0[v]']
    elif name == 'C':   # workflow pitch (take 3 voice) over take 2, which pans along the workflow graph
        inp += ['-ss', '6', '-t', f'{L:.3f}', '-i', SRC(2)]; fc.append(f'[{n}:v]setpts=PTS-STARTPTS,{VF(2, 6)}[v]')
    else:   # outro: pictures of each thing named
        cues = [(0.0 if t == 0 else out_t(ps, 3, t), v) for t, v in DVIS] + [(L, None)]
        for k, ((t, (src, s)), (t2, _)) in enumerate(zip(cues, cues[1:])):
            p = TRAILER if src == 'trailer' else SLIME if src == 'slime' else SRC(src)
            vf = 'scale=-2:1080,pad=1920:1080:(ow-iw)/2:0:color=0x0b0b10,fps=30,format=yuv420p,setsar=1' if src == 'slime' else \
                 'fps=30,format=yuv420p,setsar=1' if src == 'trailer' else VF(src, s)
            inp += ['-ss', f'{s:.3f}', '-t', f'{t2 - t:.3f}', '-i', p]; fc.append(f'[{n + k}:v]setpts=PTS-STARTPTS,{vf}[d{k}]')
        fc.append(''.join(f'[d{k}]' for k in range(len(cues) - 1)) + f'concat=n={len(cues) - 1}:v=1:a=0[v]')
    run([*inp, '-filter_complex', ';'.join(fc), '-map', '[v]', '-map', '[a]', *ENC, '-t', f'{L:.3f}', f'{OUT}.{name}.mp4'])
    return ps, L

def out_t(ps, f, t):   # time in the section of source time t (file f)
    o = 0.0
    for pf, a, b, _ in ps:
        if pf == f and a - .05 <= t < b + .05: return o + max(0, t - a)
        o += b - a
    raise ValueError(f'{t} not kept')

secs = [section(n, t) for n, t in (('B', B), ('C', C), ('D', D))]
off, t = [], TR0
for (ps, L), (_, x) in zip(secs, XF): t -= x; off.append(t); t += L
total = t; print(f'trailer {TR0:.1f}s + ' + ' + '.join(f'{n} {L:.1f}s' for n, (_, L) in zip('BCD', secs)) + f' = {total:.1f}s')
assert total < 179.5, 'over 3 min'

# captions: kept words, 6 per line, new line at a pause or sentence end
lines, cur = [], []
for (ps, _), o in zip(secs, off):
    po = o
    for f, a, b, ws in ps:
        if cur: lines.append(cur); cur = []   # every cut starts a new line
        for w in ws:
            k = w[2].strip(); key = k.lower().strip(',?!').rstrip('.')
            if key[:1] == '.' and cur: cur[-1] = (cur[-1][0], po + min(b - a, w[1] - a), cur[-1][2] + key); continue   # "5" ".5" -> "5.5"
            word = FIX.get(key, k.strip(',.?!')); word = word if word in KEEP or word[1:] != word[1:].lower() else word.lower()
            word += k[-1] if k[-1] in ',.?' else ''
            st = po + max(0, w[0] - a)
            if cur and (len(cur) >= 6 or st - cur[-1][1] > .6 or cur[-1][2][-1:] in '.?'): lines.append(cur); cur = []
            cur.append((st, po + min(b - a, w[1] - a), word))
        po += b - a
    if cur: lines.append(cur); cur = []
for i in range(len(lines) - 1, 0, -1):   # no one-word orphan lines
    if len(lines[i]) == 1 and len(lines[i - 1]) < 7 and lines[i][0][0] - lines[i - 1][-1][1] < .8: lines[i - 1] += lines.pop(i)
fmt = lambda s: f'{int(s // 3600)}:{int(s % 3600 // 60):02d}:{s % 60:05.2f}'
ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', '', '[V4+ Styles]',
       'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginV',
       'Style: C,Minecraft,44,&H00FFFFFF,&H70000000,&H70000000,0,3,10,0,2,50', '', '[Events]', 'Format: Layer, Start, End, Style, Text']
for i, ln in enumerate(lines):
    end = min(ln[-1][1] + .35, lines[i + 1][0][0] if i + 1 < len(lines) else total)
    ass.append(f'Dialogue: 0,{fmt(ln[0][0])},{fmt(end)},C,' + ' '.join(w for _, _, w in ln))
open(OUT + '.ass', 'w').write('\n'.join(ass) + '\n')
if PLAN: print('\n'.join(a.split(',', 4)[1] + ' ' + a.split(',', 4)[4] for a in ass if a.startswith('Dialogue'))); sys.exit()

# final: trailer > B > C > D with transitions, captions on top
inp = ['-i', TRAILER] + sum((['-i', f'{OUT}.{n}.mp4'] for n in 'BCD'), [])
fc = ['[0:v]fps=30,format=yuv420p,setsar=1,settb=AVTB[v0]', '[0:a]loudnorm=I=-16:TP=-1.5,aresample=48000[a0]'] + [f'[{i}:v]fps=30,format=yuv420p,setsar=1,settb=AVTB[v{i}]' for i in (1, 2, 3)] + [f'[{i}:a]anull[a{i}]' for i in (1, 2, 3)]   # settb: xfade needs equal timebases
v, a = 'v0', 'a0'
for i, ((tr, x), o) in enumerate(zip(XF, off), 1):
    fc += [f'[{v}][v{i}]xfade=transition={tr}:duration={x}:offset={o:.3f}[vx{i}]', f'[{a}][a{i}]acrossfade=d={x}[ax{i}]']; v, a = f'vx{i}', f'ax{i}'
fc.append(f"[{v}]subtitles='{OUT}.ass':fontsdir='{FONTS}'[vo]")
run([*inp, '-filter_complex', ';'.join(fc), '-map', '[vo]', '-map', f'[{a}]', *ENC, '-movflags', '+faststart', OUT])
d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT], capture_output=True, text=True).stdout)
assert abs(d - total) < .5 and d < 180, d
print('wrote', OUT, f'{d:.1f}s')
