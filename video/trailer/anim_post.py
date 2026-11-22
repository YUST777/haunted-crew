"""Post for the animation: bloom, animated montage, whip-pan blur, fades, slam flash + shake, film grain -> mp4 (cut list: cut.py).
python3 anim_post.py FRAMES_DIR OUT.mp4"""
import os, random, subprocess, sys
from PIL import Image, ImageChops, ImageEnhance
import cut
from sheet import bloom, montage
D, OUT = sys.argv[1], sys.argv[2]; P = D + '/post'; os.makedirs(P, exist_ok=True)
L = lambda n, s='': bloom(Image.open(f'{D}/f{n:04d}{s}.png').convert('RGB'))
for n in range(cut.N):
    sh, f0, f1 = cut.shot(n); K = (n - f0) / (f1 - f0 - 1)
    im = montage(L(n, 'a'), L(n, 'b'), L(n, 'c'), K, cut.PANEL) if sh == '11' else L(n); w, h = im.size
    s = abs(cut.whip(n))
    if s: im = im.resize((max(8, int(w / (1 + 30 * s))), h), Image.BOX).resize((w, h), Image.BILINEAR)   # whip pan: horizontal smear
    k = min(1, (n + 1) / 20) if sh == '1' else min(1, (n - f0 + 1) / 8) if sh == '7' else 1   # fade up from black; eyes fade in
    t = n - f0 - round(cut.SLAM * (f1 - f0 - 1)) if sh == '12' else -1                          # frames since the logo landed
    if 0 <= t < 8:   # impact: white flash and a decaying shake
        r = random.Random(n); z = int(w * .03 * (1 - t / 8)); k = 1 + 1.6 * max(0, 1 - t / 3)
        x = z + r.randint(-z, z); im = im.resize((w + 2 * z, h + 2 * z), Image.BILINEAR).crop((x, z, x + w, z + h))
    if k != 1: im = ImageEnhance.Brightness(im).enhance(k)
    im = ImageChops.add(im, Image.effect_noise((w, h), 7).convert('RGB'), 1, -128)   # film grain
    assert im.size == (w, h); im.save(f'{P}/f{n:04d}.png')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(cut.FPS), '-i', P + '/f%04d.png', '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', OUT], check=True)
