"""Post for stills: bloom + vignette, 3-panel montage (11a/b/c -> shot11), 4x3 sheet like ref/target_look.webp.
python3 sheet.py DIR  -> DIR/post/shotN.png, DIR/sheet.png"""
import os, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

def bloom(im):
    w = im.width; hi = im.point(lambda v: max(0, v - 150) * 2.4)
    for r, k in ((w / 110, .55), (w / 30, .45)):
        im = ImageChops.screen(im, hi.filter(ImageFilter.GaussianBlur(r)).point(lambda v: v * k))
    vig = Image.radial_gradient('L').resize(im.size).point(lambda v: 255 - max(0, v - 120) * .9)
    return ImageChops.multiply(im, Image.merge('RGB', (vig,) * 3))

def montage(a, b, c, p=1.0, land=(0, 0, 0)):
    """3 slanted panels. p 0..1 animates them: each slams in along the slant just before its `land` time, alternately from top and bottom."""
    w, h = a.size; out = Image.new('RGB', (w, h)); sl = w // 14; d = ImageDraw.Draw(out)
    for k, im in enumerate((a, b, c)):
        q = min(1, 1 - (land[k] - p) / .12) if p < 1 else 1
        if q <= 0: continue
        dy = int((1 - q) ** 3 * h) * (1 if k % 2 else -1); dx = -dy * sl // h   # slide along the slant
        x0, x1 = (k * w // 3 if k else -sl), ((k + 1) * w // 3 if k < 2 else w + sl)
        pts = [(x0 + sl // 2 + dx, dy), (x1 + sl // 2 + dx, dy), (x1 - sl // 2 + dx, h + dy), (x0 - sl // 2 + dx, h + dy)]
        m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).polygon(pts, fill=255)
        sh = Image.new('RGB', (w, h)); sh.paste(im, ((k - 1) * w // 3 + dx, dy)); out.paste(sh, (0, 0), m)
        for e in ((pts[0], pts[3]), (pts[1], pts[2])): d.line(e, fill=(255, 255, 255), width=max(2, w // 320))
    return out

if __name__ == '__main__':
    D = sys.argv[1]; P = D + '/post'; os.makedirs(P, exist_ok=True); L = lambda n: Image.open(f'{D}/shot{n}.png').convert('RGB')
    have = lambda n: os.path.exists(f'{D}/shot{n}.png')
    for n in list(range(1, 11)) + [12]:
        if have(n): bloom(L(n)).save(f'{P}/shot{n}.png')
    if all(have(k) for k in ('11a', '11b', '11c')): montage(*(bloom(L(k)) for k in ('11a', '11b', '11c'))).save(f'{P}/shot11.png')
    cw, ch, g = 456, 256, 16; S = Image.new('RGB', (1920, 1080)); x0 = (1920 - 4 * cw - 3 * g) // 2; y0 = (1080 - 3 * ch - 2 * g) // 2
    for i in range(12):
        f = f'{P}/shot{i + 1}.png'
        x, y = x0 + (i % 4) * (cw + g), y0 + (i // 4) * (ch + g)
        ImageDraw.Draw(S).rectangle([x - 2, y - 2, x + cw + 1, y + ch + 1], outline=(255, 255, 255), width=2)
        if os.path.exists(f): S.paste(Image.open(f).resize((cw, ch), Image.LANCZOS), (x, y))
    S.save(D + '/sheet.png')
