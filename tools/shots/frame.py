"""Frames a raw screenshot in a gradient card with a window bar, title and tags.
usage: python3 tools/shots/frame.py raw.png out.webp "Title" "Subtitle"
"""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

src, out, title, sub = sys.argv[1:5]
W, H = 2000, 1500
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# dark night background: near-black violet, soft purple glow behind the card, faint ghost pattern
bg = Image.new("RGB", (W, H), (11, 6, 20))
glow = Image.new("RGB", (W, H), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((W * 0.12, H * 0.28, W * 0.88, H * 1.05), fill=(92, 34, 140))
gd.ellipse((W * 0.30, -H * 0.10, W * 0.70, H * 0.25), fill=(60, 24, 96))
glow = glow.filter(ImageFilter.GaussianBlur(190))
bg = Image.blend(bg, glow, 0.55)

def ghost(size):
    g = Image.new("L", (size, size), 0)
    gd = ImageDraw.Draw(g)
    r = size * 0.36
    cx = size / 2
    gd.ellipse((cx - r, size * 0.08, cx + r, size * 0.08 + 2 * r), fill=255)
    gd.rectangle((cx - r, size * 0.08 + r, cx + r, size * 0.80), fill=255)
    n = 3
    w = 2 * r / n
    for i in range(n):  # wavy hem
        gd.ellipse((cx - r + i * w, size * 0.80 - w * 0.5, cx - r + (i + 1) * w, size * 0.80 + w * 0.5), fill=255)
    e = size * 0.07
    for ex in (cx - r * 0.42, cx + r * 0.42):
        gd.ellipse((ex - e, size * 0.34 - e, ex + e, size * 0.34 + e * 1.5), fill=0)
    return g

pattern = Image.new("RGBA", (W, H), (0, 0, 0, 0))
step, size = 150, 74
tile = ghost(size)
for row, y in enumerate(range(-20, H, step)):
    for x in range(-40 + (step // 2 if row % 2 else 0), W, step):
        a = 26 if (row + x // step) % 3 else 14
        layer = Image.new("RGBA", (size, size), (180, 140, 255, 0))
        layer.putalpha(tile.point(lambda v, a=a: v * a // 255))
        pattern.alpha_composite(layer, (x, y))
bg = Image.alpha_composite(bg.convert("RGBA"), pattern).convert("RGB")
# vignette
vig = Image.new("L", (W, H), 0)
ImageDraw.Draw(vig).ellipse((-W * 0.25, -H * 0.2, W * 1.25, H * 1.2), fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(160))
bg = Image.composite(bg, Image.new("RGB", (W, H), (4, 2, 9)), vig)
d = ImageDraw.Draw(bg)

def text_center(y, s, font, fill):
    w = d.textlength(s, font=font)
    d.text(((W - w) / 2, y), s, font=font, fill=fill)

text_center(90, title, ImageFont.truetype(BOLD, 84), (255, 255, 255))
text_center(205, sub, ImageFont.truetype(FONT, 38), (205, 185, 230))

# window card
shot = Image.open(src).convert("RGB")
cw = 1640
ch = int(shot.height * cw / shot.width)
shot = shot.resize((cw, ch), Image.LANCZOS)
bar = 56
card_w, card_h = cw, ch + bar
cx, cy = (W - card_w) // 2, 320
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((cx, cy + 24, cx + card_w, cy + card_h + 24), radius=26, fill=(0, 0, 0, 200))
shadow = shadow.filter(ImageFilter.GaussianBlur(34))
bg = Image.alpha_composite(bg.convert("RGBA"), shadow)
card = Image.new("RGBA", (card_w, card_h), (22, 18, 28, 255))
cd = ImageDraw.Draw(card)
for i, col in enumerate(((255, 95, 87), (254, 188, 46), (40, 200, 64))):
    cd.ellipse((22 + i * 34, 17, 42 + i * 34, 37), fill=col)
cd.rounded_rectangle((card_w // 2 - 300, 10, card_w // 2 + 300, 46), radius=18, fill=(40, 34, 48))
lab = "haunted-crew · Minecraft 26.3"
cd.text(((card_w - cd.textlength(lab, font=ImageFont.truetype(FONT, 22))) / 2, 16), lab, font=ImageFont.truetype(FONT, 22), fill=(180, 170, 195))
card.paste(shot, (0, bar))
mask = Image.new("L", (card_w, card_h), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, card_w, card_h), radius=26, fill=255)
bg.paste(card, (cx, cy), mask)
final_h = cy + card_h + 90
bg.convert("RGB").crop((0, 0, W, final_h)).save(out, "WEBP", quality=88)
print(out, W, final_h)
