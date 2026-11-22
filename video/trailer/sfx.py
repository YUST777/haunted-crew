"""Sound mix for the cold open, cue times from the cut list (cut.py).
SFX: Mixkit (mixkit.co, Mixkit Sound Effects Free License) in audio/sfx_mixkit/. Optional theme music file + start offset.
python3 sfx.py IN.mp4 OUT.mp4 [MUSIC.mp3 [offset_s]]   -> muxes the mix onto the video (video stream copied)"""
import os, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cut
P = os.path.dirname(os.path.abspath(__file__)) + '/../audio/'
S = cut.START; LEN = cut.N / cut.FPS; SLAM = S['12'] + cut.SLAM * (LEN - S['12']); UI0 = S['10'] + (37 * .022 + .2)   # logo lands; first agent row appears (ui.py)
CUES = [  # (file, time s, volume, flags, max length s). flags: p = loudest peak lands on time, e = sound ends on time, v = reversed, r = hall echo. Plain cues skip leading silence.
    ('room_wind', 0, .35, '', LEN), ('tomb_amb', 0, .3, '', LEN),          # room tone
    ('typing', S['4'], 1.0, 'r', S['5'] - S['4']), ('typing', S['5'], 1.6, 'r', S['6'] - S['5']),   # typing: over the shoulder, then the keyboard close-up
    ('drum_heartbeat', S['7'] + .05, 1.0, '', 0),                          # black + orange eyes
    ('horror_hit', S['8'], 1.0, 'p', 0),    # the turn
    ('heartbeat', S['9'] + .2, .9, 'r', 0), ('heartbeat', S['9'] + .8, .9, 'r', 0),       # silent cue
    ('tech_slide', S['10'], .6, '', 0), *[('key', UI0 + i * .12, .7, 'r', 0) for i in range(4)],  # UI rows
    *[('whoosh_b', S['11'] + k * (S['12'] - S['11']), .35, 'p', 0) for k in cut.PANEL],  # one 0.6 s tick per montage panel; owner hates long swoops
    ('big_impact', SLAM, 1.0, 'p', 0), ('metal_impact', SLAM, .9, 'p', 0), ('golem_stomp', SLAM, .5, 'p', 0),  # logo slam
    ('sparkle', S['12'] + .45 * (LEN - S['12']), .35, '', 0),              # tagline
]


def probe(f):
    a = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True, check=True).stdout, np.int16)
    a = np.abs(a.astype(np.int32))
    return len(a) / 8000, int(a.argmax()) / 8000, int((a > .1 * a.max()).argmax()) / 8000  # duration, time of loudest peak, onset


inp, fc = [], []
for i, (n, t, v, fl, ln) in enumerate(CUES):
    f = P + f'sfx_mixkit/{n}.mp3'; dur, pk, on = probe(f); ss = 0 if fl.strip('r') else max(0, on - .02)
    if 'v' in fl: pk = dur - pk
    if 'e' in fl: t -= dur
    elif 'p' in fl: t -= pk
    if t < 0: ss -= t; t = 0
    trim = f'atrim={ss}:{ss + ln if ln else dur},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,' + (f'afade=t=out:st={ln - .15}:d=0.15,' if ln else '')
    inp += ['-i', f]; fc.append(f'[{i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,' + ('areverse,' if 'v' in fl else '') + trim + ('aecho=0.8:0.5:70|130:0.3|0.2,' if 'r' in fl else '') + f'volume={v},adelay={int(t * 1000)}:all=1[a{i}]')
n = len(CUES); mus = sys.argv[3:4]
if mus:  # theme music under the SFX
    off = float(sys.argv[4]) if len(sys.argv) > 4 else 0
    inp += ['-ss', str(off), '-i', mus[0]]; fc.append(f'[{n + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.6[a{n}]'); n += 1
fc.append(''.join(f'[a{i}]' for i in range(n)) + f'amix=inputs={n}:normalize=0,alimiter=limit=0.9,afade=t=in:d=0.5,afade=t=out:st={LEN - .5}:d=0.5,atrim=0:{LEN}[m]')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', sys.argv[1], *inp, '-filter_complex', ';'.join(fc), '-map', '0:v', '-map', '[m]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', sys.argv[2]], check=True)
d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', sys.argv[2]], capture_output=True, text=True).stdout)
assert abs(d - LEN) < .1, d
print('wrote', sys.argv[2], 'music' if mus else 'no music')
