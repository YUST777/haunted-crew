"""Final Kiroween demo at 2560x1440: trailer intro, then the cleaned talk in a rounded card on the ghost-pattern background,
captions under the card, Instagram view proof on the two "600k" lines, the Claude pop-up at ~2:48 patched out, cleaned voice.
python3 compose.py VOICE.wav OUT.mp4"""
import json, os, subprocess, sys, html
from PIL import Image, ImageDraw, ImageFilter, ImageFont
H0 = os.path.dirname(os.path.abspath(__file__)); W_ = f'{H0}/work'; VOICE, OUT = sys.argv[1:3]
CW, CH = 2560, 1440; CX, CY, CARD_W, CARD_H, R = 192, 48, 2176, 1224, 36
FONT = f'{H0}/../../../shared/fonts/minecraft/Minecraft.ttf'
TRAILER = f'{H0}/../renders/haunted_crew_v5_FINAL.mp4'; SLIME = f'{H0}/../../09_asmr/08_slime_jelly/output/08_slime_jelly.mp4'
MAP = json.load(open(f'{W_}/talk_map.json')); TR = {int(k): [w for s in v for w in s['w']] for k, v in json.load(open(f'{W_}/tr.json')).items()}
T0 = 20.0; XF = .6; OFF = T0 - XF   # talk starts while the trailer fades
O3 = next(p['o'] for p in MAP['pieces'] if p['f'] == 3); POP = (O3 + 75.8 - 21.0, O3 + 81.55 - 21.0)   # Claude pop-up in the rec2 workflow footage (rec2 75.8-81.5 s; that footage starts at rec2 21 s under rec3's first piece)
MUSIC = f'{H0}/../audio/music_minecart_moonlight.mp3'   # owner's Suno theme, 4:00 (longer than the talk: no looping)
URL = 'https://haunted-crew.pages.dev/'

def tt(f, t):   # source time -> talk time
    for p in MAP['pieces']:
        if p['f'] == f and p['a'] - .02 <= t <= p['b'] + .02: return p['o'] + max(0, t - p['a'])

# background: ghost pattern (recipe of ~/Desktop/kiroween/tools/shots/frame.py) + the card's soft shadow baked in
bg = Image.open(f'{H0}/hf/assets/bg.png').resize((CW, CH), Image.LANCZOS).convert('RGBA')
sh = Image.new('RGBA', (CW, CH)); ImageDraw.Draw(sh).rounded_rectangle((CX, CY + 26, CX + CARD_W, CY + CARD_H + 26), R, fill=(0, 0, 0, 190))
bg = Image.alpha_composite(bg, sh.filter(ImageFilter.GaussianBlur(36)))
ImageDraw.Draw(bg).rounded_rectangle((CX - 3, CY - 3, CX + CARD_W + 2, CY + CARD_H + 2), R + 3, outline=(190, 150, 255, 140), width=3)
bg.convert('RGB').save(f'{W_}/bg1440.png')
SC = .7; BW, BH = 1524, 858; BX, BY = 64, CY + (CARD_H - BH) // 2   # landing-page layout: card at 70 %
import qrcode
PS2F = f'{H0}/hf/assets/fonts/press-start-2p.ttf'
def side_layout(out, title, qrs):
    """card at 70 % on the left, a panel on the right with a title and QR codes [(url, label)]"""
    im = Image.open(f'{H0}/hf/assets/bg.png').resize((CW, CH), Image.LANCZOS).convert('RGBA')
    sh = Image.new('RGBA', (CW, CH)); ImageDraw.Draw(sh).rounded_rectangle((BX, BY + 20, BX + BW, BY + BH + 20), 28, fill=(0, 0, 0, 190)); im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(30)))
    d = ImageDraw.Draw(im); d.rounded_rectangle((BX - 3, BY - 3, BX + BW + 2, BY + BH + 2), 28, outline=(190, 150, 255, 140), width=3)
    x0 = BX + BW + 70; w0 = CW - 64 - x0; cx = x0 + w0 // 2
    d.rounded_rectangle((x0, BY, x0 + w0, BY + BH), 28, fill=(18, 10, 32, 235), outline=(124, 255, 155, 255), width=4)
    t = ImageFont.truetype(PS2F, 36); d.text((cx - d.textlength(title, font=t) / 2, BY + 40), title, font=t, fill=(124, 255, 155))
    q = 460 if len(qrs) == 1 else 190; top = BY + 120; row = (BH - 140) // len(qrs)
    for k, (url, lab) in enumerate(qrs):
        qr = qrcode.QRCode(border=2, box_size=10); qr.add_data(url); qr.make(fit=True)
        qi = qr.make_image(fill_color='black', back_color='white').convert('RGB').resize((q, q), Image.NEAREST); y = top + k * row
        if len(qrs) == 1:
            im.paste(qi, (cx - q // 2, y + 20))
            for txt, fnt, dy, col in ((lab, ImageFont.truetype(FONT, 46), q + 60, (255, 255, 255)), ('scan, copy the prompt, paste in Kiro', ImageFont.truetype(FONT, 30), q + 130, (200, 185, 230))):
                d.text((cx - d.textlength(txt, font=fnt) / 2, y + dy), txt, font=fnt, fill=col)
        else:   # QR left, label right
            im.paste(qi, (x0 + 40, y)); f1, f2 = ImageFont.truetype(PS2F, 24), ImageFont.truetype(FONT, 30)
            d.text((x0 + 40 + q + 30, y + 50), lab, font=f1, fill=(255, 255, 255)); d.text((x0 + 40 + q + 30, y + 100), url.replace('https://', '').rstrip('/'), font=f2, fill=(200, 185, 230))
    im.convert('RGB').save(out)
side_layout(f'{W_}/bgB.png', 'TRY IT', [(URL, 'haunted-crew.pages.dev')])
side_layout(f'{W_}/bgC.png', 'LINKS', [('https://github.com/YUST777/haunted-crew', 'GITHUB'), (URL, 'WEBSITE'), (URL + 'docs', 'DOCS')])
m = Image.new('L', (CARD_W, CARD_H), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, CARD_W - 1, CARD_H - 1), R, fill=255); m.save(f'{W_}/mask.png')

# proof card: real numbers from Instagram owner insights for reel DfVIBdBNwPd (pulled 2026-11-22 via vidIQ)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '8', '-i', SLIME, '-frames:v', '1', '-vf', 'scale=300:-1', f'{W_}/reel_thumb.png'], check=True)
pc = Image.new('RGBA', (760, 600), (0, 0, 0, 0)); d = ImageDraw.Draw(pc)
d.rounded_rectangle((0, 0, 759, 599), 28, fill=(18, 10, 32, 238), outline=(124, 255, 155, 255), width=4)
th = Image.open(f'{W_}/reel_thumb.png'); th = th.crop((0, 0, 300, 533)); pc.paste(th, (28, 34))
f = lambda s: ImageFont.truetype(FONT, s); x = 360
d.text((x, 40), 'INSTAGRAM INSIGHTS', font=f(30), fill=(124, 255, 155)); d.text((x, 84), '@blocklab_mc', font=f(28), fill=(216, 200, 255))
d.text((x, 124), 'Jelly Slime Block reel', font=f(26), fill=(216, 200, 255))
for k, (n, lab) in enumerate((('663,649', 'views'), ('24,690', 'likes'), ('2,267', 'shares'), ('1,985', 'saves'))):
    d.text((x, 190 + k * 82), n, font=f(54 if k == 0 else 40), fill=(255, 255, 255)); d.text((x + (300 if k == 0 else 190), 210 + k * 82), lab, font=f(26), fill=(200, 185, 230))
d.text((x, 548), 'built with the Kiro workflow', font=f(22), fill=(255, 184, 77))
pc.save(f'{W_}/proof.png')
proofs = [tt(3, w[0]) for w in TR[3] if w[2].strip().lower().startswith('600k') and tt(3, w[0]) is not None]
assert len(proofs) == 2, proofs

# captions (ASS), under the card
FIX = {'kiru': 'Kiro', "kiru's": "Kiro's", 'oppos': 'Opus', 'hikos': 'Haiku', 'mcbs': 'MCPs', 'coagent': 'agent', 'decoder': 'the coder', 'viewer': 'reviewer', 'docks': 'docs',
       'award': 'world', 'an': 'a', 'comment': 'command', '24p': '240p', '250p': '240p', 'collab': 'Colab', 't4': 'T4', 'someone': 'summon', 'shats': 'chats', 'life': 'live'}
KEEP = {'I', 'Kiro', "Kiro's", 'Minecraft', 'Haunted', 'Crew', 'Frankenstein', 'Opus', 'Haiku', 'YouTube', 'Reddit', 'GitHub', 'Twitter', 'Google', 'Colab', 'Instagram', 'Blender', 'AI', 'CLI', 'MCPs', 'T4', 'UI'}
words = []
for fi, ws in TR.items():
    for w in ws:
        a, b = tt(fi, w[0]), tt(fi, w[1])
        if a is None or b is None: continue
        k = w[2].strip(); key = k.lower().strip(',?!').rstrip('.')
        if key[:1] == '.' and words: words[-1][2] += key; continue
        word = FIX.get(key, k.strip(',.?!')); word = word if word in KEEP or word[1:] != word[1:].lower() else word.lower()
        if fi == 3 and key == 'high': word = 'Haiku'
        words.append([a + OFF, b + OFF, word + (k[-1] if k[-1] in ',.?' else '')])
words.sort(); groups, cur = [], []
for w in words:
    if cur and (len(cur) >= 5 or w[0] - cur[-1][1] > .45 or cur[-1][2][-1:] in '.?'): groups.append(cur); cur = []
    cur.append(w)
groups.append(cur); END = OFF + MAP['length']
fmt = lambda s: f'{int(s // 3600)}:{int(s % 3600 // 60):02d}:{s % 60:05.2f}'
ass = ['[Script Info]', 'ScriptType: v4.00+', 'WrapStyle: 2', f'PlayResX: {CW}', f'PlayResY: {CH}', '', '[V4+ Styles]',
       'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginV',
       'Style: C,Minecraft,68,&H00FFFFFF,&H00000000,&H00000000,0,1,5,2,5,0', '', '[Events]', 'Format: Layer, Start, End, Style, Text']
for i, g in enumerate(groups):
    e = min(g[-1][1] + .3, groups[i + 1][0][0] - .03 if i + 1 < len(groups) else END)   # never two lines on screen at once
    ass.append(f'Dialogue: 0,{fmt(max(OFF, g[0][0] - .05))},{fmt(e)},C,{{\\an5\\pos({CW // 2},{CY + CARD_H + (CH - CY - CARD_H) // 2})}}' + ' '.join(w[2] for w in g))   # fixed centre point: no jumping
open(f'{W_}/caps.ass', 'w').write('\n'.join(ass) + '\n')

# section cards: full-frame title that slides in and out over the talk at each section start
PS2 = f'{H0}/hf/assets/fonts/press-start-2p.ttf'; first = lambda cond: next(p['o'] for p in MAP['pieces'] if cond(p))
SECTIONS = [(OFF + .45, '01', 'THE IDEA'), (OFF + first(lambda p: p['f'] == 1 and abs(p['a'] - 23.9) < .5), '02', 'LANDING PAGE'),
            (OFF + first(lambda p: p['f'] == 1 and abs(p['a'] - 86.2) < .5), '03', 'THE MOD'), (OFF + first(lambda p: p['f'] == 3), '04', 'WORKFLOWS'),
            (OFF + first(lambda p: p['pic'] == 'outro'), '05', 'BUILT WITH KIRO')]
for k, (_, num, title) in enumerate(SECTIONS):
    im = Image.open(f'{W_}/bg1440.png').convert('RGB'); im = Image.blend(im, Image.new('RGB', im.size, (10, 5, 20)), .35); d = ImageDraw.Draw(im)
    for txt, fnt, y, col in ((num, ImageFont.truetype(PS2, 90), 470, (124, 255, 155)), (title, ImageFont.truetype(PS2, 120), 640, (255, 255, 255)), ('HAUNTED CREW', ImageFont.truetype(FONT, 44), 860, (200, 180, 240))):
        d.text(((CW - d.textlength(txt, font=fnt)) / 2, y), txt, font=fnt, fill=col)
    im.save(f'{W_}/sec{k}.png')
# install prompt close-up: Kiro chat panel with the pasted prompt (rec1 48 s), on "copy it, bring it to Kiro and paste it"
LX = .6; LT1 = SECTIONS[1][0] - OFF + 1.5; LT2 = first(lambda p: p['f'] == 1 and abs(p['a'] - 62.5) < .5) - .2   # landing-page layout: until the prompt is pasted in Kiro
LE1 = tt(3, 112.9); LE2 = MAP['length'] + .5   # links layout: from "methodologies, workflows, hooks" to the end
ZT0 = tt(1, 41.6); ZT1 = tt(1, 46.0); assert ZT0 and ZT1 and ZT1 > ZT0, (ZT0, ZT1)

# filter graph
px, py, pw, ph = 1480, 0, CARD_W - 1480, 125   # pop-up area in the card video
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{POP[0] - .4:.2f}', '-i', f'{W_}/talk_hi.mp4', '-frames:v', '1', '-vf', f'crop={pw}:{ph}:{px}:{py}', f'{W_}/patch.png'], check=True)   # clean still of the pop-up area
inp = ['-loop', '1', '-i', f'{W_}/patch.png', '-loop', '1', '-i', f'{W_}/bg1440.png', '-i', f'{W_}/talk_hi.mp4', '-i', f'{W_}/mask.png', '-i', TRAILER, '-i', VOICE, '-loop', '1', '-i', f'{W_}/proof.png', '-ss', '48.0', '-t', f'{ZT1 - ZT0 + .5:.2f}', '-i', f'{H0}/rec/rec1.mp4'] + sum((['-loop', '1', '-i', f'{W_}/sec{k}.png'] for k in range(len(SECTIONS))), [])
NB = inp.count('-i'); inp += ['-loop', '1', '-i', f'{W_}/bgB.png']   # input index of the landing-page background
NC = inp.count('-i'); inp += ['-loop', '1', '-i', f'{W_}/bgC.png']   # links background
NM = inp.count('-i'); inp += ['-i', MUSIC]
NT = inp.count('-i'); inp += ['-ss', f'{LT1:.3f}', '-t', f'{LT2 - LT1 + LX:.3f}', '-i', f'{W_}/talk_hi.mp4', '-i', f'{W_}/mask.png']
# HyperFrames explainer clips shown in the card instead of the recording: crew builds the site (The Idea), workflow run (Workflows)
CLIPS = [(f'{H0}/clips/crew2.mp4', tt(1, 124.4) - .3, 12.0),   # crew builds the site: on "mention ... make me a website"
         (f'{H0}/clips/flow3.mp4', None, 15.0)]   # workflow run: starts when the first 600k proof card has gone (set below)
NK = inp.count('-i'); inp += sum((['-i', c] for c, _, _ in CLIPS), [])
NE = inp.count('-i'); inp += ['-ss', f'{LE1:.3f}', '-t', f'{LE2 - LE1:.3f}', '-i', f'{W_}/talk_hi.mp4', '-i', f'{W_}/mask.png']
CLIPS[1] = (CLIPS[1][0], proofs[0] + 6.3, CLIPS[1][2]); assert all(c[1] for c in CLIPS)
pt = ' + '.join(f'between(t,{p:.2f},{p + 6:.2f})' for p in proofs)
fc = [f"[0:v]format=yuv420p,trim=duration={MAP['length']:.2f}[patch]", f"[2:v][patch]overlay={px}:{py}:enable='between(t,{POP[0]},{POP[1]})'[tv1]",
      '[7:v]nullsink',
      *[f'[{NK + k}:v]scale={CARD_W}:{CARD_H}:flags=lanczos,fps=30,format=yuva420p,fade=t=in:st=0:d=0.4:alpha=1,fade=t=out:st={d - .4:.2f}:d=0.4:alpha=1,setpts=PTS-STARTPTS+{t:.3f}/TB[k{k}]' for k, (_, t, d) in enumerate(CLIPS)],
      '[tv1][k0]overlay=0:0:eof_action=pass[tvk]', '[tvk][k1]overlay=0:0:eof_action=pass[tv2]',   # no zoom: the real footage shows Kiro opening and the prompt being pasted
      '[3:v]format=gray[msk]', '[tv2]format=yuva420p[tva]', '[tva][msk]alphamerge[card]',
      f"[1:v]trim=duration={MAP['length']:.2f},setpts=PTS-STARTPTS[bgv]", f'[bgv][card]overlay={CX}:{CY}:shortest=1,format=yuv420p,settb=AVTB[sA]',
      # landing-page layout: its own short decode of the footage (no split: a split here buffered frames until the process died)
      f'[{NT}:v]format=yuva420p[tb]', f'[{NT + 1}:v]format=gray[mb]', '[tb][mb]alphamerge,' + f'scale={BW}:{BH}:flags=lanczos[cB]',
      f"[{NB}:v]trim=duration={LT2 - LT1 + LX:.3f},setpts=PTS-STARTPTS[bgB]", f'[bgB][cB]overlay={BX}:{BY}:shortest=1,format=yuva420p,'
      f'fade=t=in:st=0:d={LX}:alpha=1,fade=t=out:st={LT2 - LT1:.3f}:d={LX}:alpha=1,setpts=PTS-STARTPTS+{LT1:.3f}/TB[sB]',
      '[sA][sB]overlay=0:0:eof_action=pass,format=yuv420p[sAB]',
      f'[{NE}:v]format=yuva420p[te]', f'[{NE + 1}:v]format=gray[me]', '[te][me]alphamerge,' + f'scale={BW}:{BH}:flags=lanczos[cE]',
      f"[{NC}:v]trim=duration={LE2 - LE1:.3f},setpts=PTS-STARTPTS[bgC]", f'[bgC][cE]overlay={BX}:{BY}:shortest=1,format=yuva420p,'
      f'fade=t=in:st=0:d={LX}:alpha=1,setpts=PTS-STARTPTS+{LE1:.3f}/TB[sE]',
      '[sAB][sE]overlay=0:0:eof_action=pass,format=yuv420p[stage]',
      f"[6:v]format=rgba,trim=duration={MAP['length']:.2f}[pf]", f"[stage][pf]overlay={CX + CARD_W - 760 - 40}:{CY + CARD_H - 600 - 40}:enable='{pt}'[talkv]",
      f"[4:v]scale={CW}:{CH}:flags=lanczos,fps=30,format=yuv420p,setsar=1,settb=AVTB[trv]", '[talkv]fps=30,settb=AVTB,setsar=1[tkv]',
      f'[trv][tkv]xfade=transition=zoomin:duration={XF}:offset={OFF:.2f}[sx0]',
      '[4:a]loudnorm=I=-16:TP=-1.5,aresample=48000[ta]', '[5:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000,aformat=channel_layouts=stereo,asplit[vm][vsc]',
      # background music: the owner's theme, quiet, ducked under the voice
      f"[{NM}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration={MAP['length']:.2f},loudnorm=I=-27:TP=-3,aresample=48000,afade=t=in:d=2,afade=t=out:st={MAP['length'] - 4:.2f}:d=4[mus]",
      '[mus][vsc]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=500[mduck]', '[vm][mduck]amix=inputs=2:normalize=0,alimiter=limit=0.95[va]',
      f'[ta][va]acrossfade=d={XF}[ao]']
for k, (t, _, _) in enumerate(SECTIONS):
    a, b = t - .2, t + 1.25; inn = f'[cs{k}]'
    fc += [f"[{8 + k}:v]format=rgba,trim=duration={END:.2f}{inn}",
           f"[sx{k}]{inn}overlay=x='if(lt(t,{a + .35:.2f}),W*(1-(t-{a:.2f})/0.35),if(lt(t,{b:.2f}),0,-W*(t-{b:.2f})/0.35))':y=0:enable='between(t,{a:.2f},{b + .35:.2f})'[sx{k + 1}]"]
fc.append(f"[sx{len(SECTIONS)}]subtitles='{W_}/caps.ass':fontsdir='{os.path.dirname(FONT)}'[vo]")
subprocess.run(['ffmpeg', '-y', '-loglevel', 'warning', *inp, '-filter_complex', ';'.join(fc), '-map', '[vo]', '-map', '[ao]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '17',
                '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', os.environ.get('TEST_T', f'{END:.2f}'), OUT], check=True)
if os.environ.get('TEST_T'): sys.exit(print('test', OUT))
d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT], capture_output=True, text=True).stdout)
assert abs(d - END) < .3 and d <= 250, d   # max 4:10
print('wrote', OUT, f'{d:.1f}s', 'proof at', [round(p + OFF, 1) for p in proofs])
