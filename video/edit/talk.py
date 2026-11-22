"""Talk track for the Kiroween demo: the owner's whole talk, cleaned. Cuts only inside measured silences (> 0.7 s -> 0.35 s), so no word is clipped.
python3 talk.py   -> work/talk.mp4 (1920x1080 30 fps, cleaned voice) + work/talk_map.json (pieces: file, src a, src b, out start)
Sources: rec/rec1.mp4 walkthrough, rec/rec2.mp4 workflow take (graph footage), rec/rec3.mp4 workflow pitch (voice used)."""
import json, os, re, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = lambda f: f'{HERE}/rec/rec{f}.mp4'; W = f'{HERE}/work'
# (voice file, start, end, picture): picture None = same file; ('rec2', t0) = continuous footage from rec2 at t0; 'outro' = a picture per thing named
WF = ('rec2', 21.0)   # rec2 is a retake of rec3: only its footage is used (it pans along the workflow graph), never its voice
TAKES = [(1, 5.4, 22.3, None),        # hello ... Frankenstein between Minecraft and AI agents
         (1, 23.95, 31.9, None),      # landing page, copy the prompt: installs the mod, the agent, the CLI
         (1, 36.1, 46.0, ('rec1', 39.1)),  # a bridge between Kiro CLI and Minecraft; paste it in Kiro (picture runs 3 s ahead: Kiro opens, the prompt is pasted)
         (1, 62.4, 72.35, None),      # the landing page: workflow, agents, custom agents
         (1, 73.35, 83.7, None),      # as you saw, the first 15 s were made in Kiro ... it's in the mod
         (1, 86.4, 111.25, None),     # the mod: world, /hauntedhouse, mansion, tutorial list
         (1, 117.9, 121.95, None),    # agents console, start your work
         (1, 123.75, 131.0, None),    # mention a ghost: "make me a website, run 15 agents" (back in: 4:10 is fine)
         (1, 133.85, 137.95, None),   # let's test it live, go to the planner
         (1, 147.5, 164.4, None),     # I want to make a Blender vid ... the workflow is the best part
         (3, 4.75, 43.25, WF),        # Blender short workflow: 600k, Opus boss, 15 Haiku agents, MCPs, builds it
         (3, 45.15, 85.4, WF),        # 240p preview on Colab, check, full render, Haiku watcher, $0
         (3, 87.15, 91.1, 'outro'),   # I used Kiro to the max: landing page
         (3, 97.85, 124.3, 'outro', 'exact'),   # Kiro built it ... hooks, skeleton crew ... if you know how to use it right
         (3, 126.57, 129.6, 'outro', 'exact')]  # thank you judges, have a great day (the corrected retake; skips "and thank you judges have a good day, I")
OUTRO = [(87.15, (1, 6.0)), (97.9, (1, 63.0)), (100.5, (1, 91.0)), (101.2, (1, 101.5)), (102.6, ('trailer', 4.0)), (104.3, ('slime', 2.0)),
         (109.55, (2, 108.0)), (126.5, ('trailer', 16.8))]
TRAILER = f'{HERE}/../renders/haunted_crew_v5_FINAL.mp4'; SLIME = f'{HERE}/../../09_asmr/08_slime_jelly/output/08_slime_jelly.mp4'
SIZE = os.environ.get('TALK_SIZE', '1920x1080'); OUTV = os.environ.get('TALK_OUT', 'talk.mp4')   # e.g. TALK_SIZE=2176x1224 for the 1440p card
TAIL = f"scale={SIZE.replace('x', ':')}:flags=lanczos,fps=30,format=yuv420p,setsar=1"
def VF(f, t):   # crop window chrome (measured on the 2560x1600 recordings): browser tabs/URL bar, or the Minecraft title bar
    return ('crop=2400:1350:80:250,' if f == 1 and t < 86 else 'crop=2560:1440:0:158,') + TAIL
VOICE = 'highpass=f=80,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000'

def silences(f, a, b):
    r = subprocess.run(['ffmpeg', '-ss', str(a), '-t', str(b - a), '-i', SRC(f), '-af', 'silencedetect=noise=-35dB:d=0.7', '-f', 'null', '-'], capture_output=True, text=True).stderr
    st = [float(x) + a for x in re.findall(r'silence_start: ([\d.]+)', r)]; en = [float(x) + a for x in re.findall(r'silence_end: ([\d.]+)', r)]
    return list(zip(st, en))

ENV = {}
def env(f):   # 100 Hz RMS envelope of a recording
    if f not in ENV:
        import numpy as np
        x = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', SRC(f), '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True, check=True).stdout, np.int16).astype(float)
        ENV[f] = np.sqrt((x[:len(x) // 80 * 80].reshape(-1, 80) ** 2).mean(1))
    return ENV[f]
def snap(f, t, r=.2):
    e = env(f); i0, i1 = max(0, int((t - r) * 100)), min(len(e), int((t + r) * 100)); return (i0 + int(e[i0:i1].argmin())) / 100

def pieces():
    out = []
    for f, a, b, pic, *ex in TAKES:
        if not ex: a, b = snap(f, a), snap(f, b)   # 'exact' = cut points measured by hand
        s = a
        for s0, s1 in silences(f, a, b):
            if s1 > b - .05: break
            mid = (s0 + s1) / 2; out.append((f, s, mid - .175, pic)); s = mid + .175   # keep 0.35 s of the pause
        out.append((f, s, b, pic))
    return [p for p in out if p[2] - p[1] > .05]

ps = pieces(); t = 0.0; MAP = []
for f, a, b, pic in ps: MAP.append(dict(f=f, a=round(a, 3), b=round(b, 3), o=round(t, 3), pic=pic if isinstance(pic, str) else None)); t += b - a
L = t; inp, fc = [], []
for i, (f, a, b, pic) in enumerate(ps):
    inp += ['-ss', f'{a:.3f}', '-t', f'{b - a:.3f}', '-i', SRC(f)]
    fc.append(f'[{i}:a]asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st={b - a - .02:.3f}:d=0.02[a{i}]')
fc.append(''.join(f'[a{i}]' for i in range(len(ps))) + f'concat=n={len(ps)}:v=0:a=1,{VOICE}[a]')
# picture: runs of pieces with the same picture rule -> segments (src, start, dur, filter), joined by short dissolves
XD = 0.3   # dissolve length; each segment but the last carries XD extra so the joins keep the picture in sync with the voice
segs, n = [], len(ps); k = 0
while k < n:
    pic = ps[k][3]; j = k
    while j + 1 < n and ps[j + 1][3] == pic: j += 1
    dur = sum(p[2] - p[1] for p in ps[k:j + 1]); o0 = sum(p[2] - p[1] for p in ps[:k])
    if pic is None:
        for q in range(k, j + 1): segs.append((SRC(ps[q][0]), ps[q][1], ps[q][2] - ps[q][1], VF(ps[q][0], ps[q][1])))
    elif isinstance(pic, tuple):   # continuous footage from another moment
        fs = int(pic[0][-1]); segs.append((SRC(fs), pic[1], dur, VF(fs, pic[1])))
    else:   # outro: cue times are in rec3 source time; map to output time
        def ot(st):
            for p in MAP:
                if p['f'] == 3 and p['a'] - .05 <= st < p['b'] + .05: return p['o'] + max(0, st - p['a'])
            return min(p['o'] for p in MAP if p['f'] == 3 and p['a'] >= st)
        cues = [(ot(s_), v) for s_, v in OUTRO] + [(o0 + dur, None)]; cues[0] = (o0, cues[0][1])
        for (c0, (src, s_)), (c1, _) in zip(cues, cues[1:]):
            p = TRAILER if src == 'trailer' else SLIME if src == 'slime' else SRC(src)
            vf = f"scale=-2:{SIZE.split('x')[1]},pad={SIZE.replace('x', ':')}:(ow-iw)/2:0:color=0x0b0614,fps=30,format=yuv420p,setsar=1" if src == 'slime' else TAIL if src == 'trailer' else VF(src, s_)
            segs.append((p, s_, c1 - c0, vf))
    k = j + 1
base = len(inp) // 6; cum = 0.0
for i, (p, st, d, vf) in enumerate(segs):
    inp += ['-ss', f'{st:.3f}', '-t', f'{d + (XD if i < len(segs) - 1 else 0):.3f}', '-i', p]
    fc.append(f'[{base + i}:v]setpts=PTS-STARTPTS,{vf},settb=AVTB[v{i}]')
last = 'v0'
for i in range(1, len(segs)):
    cum += segs[i - 1][2]; fc.append(f'[{last}][v{i}]xfade=transition=fade:duration={XD}:offset={cum:.3f}[x{i}]'); last = f'x{i}'
fc.append(f'[{last}]null[v]')
assert all(inp[i] == '-ss' for i in range(0, len(inp), 6)), 'input index math assumes 6 args per input'
json.dump(dict(length=round(L, 3), pieces=MAP), open(f'{W}/talk_map.json', 'w'), indent=1)
print(f'{len(ps)} pieces, talk {L:.1f}s')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *inp, '-filter_complex', ';'.join(fc), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'fast', '-crf', os.environ.get('TALK_CRF', '18'),
                '-g', '30', '-c:a', 'aac', '-b:a', '192k', '-t', f'{L:.3f}', '-movflags', '+faststart', f'{W}/{OUTV}'], check=True)
d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'{W}/{OUTV}'], capture_output=True, text=True).stdout)
assert abs(d - L) < .2, d; print('wrote work/talk.mp4', round(d, 1))
