"""Screen textures for the trailer, drawn with PIL in the Minecraft font (look: ref/target_look.webp).

screen(t) -> 1500x700 "run task" panel, t = seconds into the reveal (command types, 4 agent rows fill).
Also code.png (monitor), blueprint.png, deploy.png (crate icon), web.png (spider web, alpha).
Run: python3 ui.py OUT_DIR FRAMES FPS -> OUT_DIR/screen_0001.png ...
"""
import math, os, random, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, '../../../shared/fonts/minecraft/Minecraft.ttf')
W, H = 1500, 700
BG, PANEL, LINE, RIM = (6, 12, 28), (10, 20, 44), (40, 70, 130), (70, 140, 255)
ORANGE, WHITE, GREY = (255, 165, 40), (225, 235, 255), (110, 130, 170)
CMD = 'run task: build & deploy Haunted Crew'
AGENTS = ['Planner', 'Coder', 'Tester', 'Deployer']   # trailer names (owner's storyboard)

def f(sz): return ImageFont.truetype(FONT, sz)

def ghost_icon(d, x, y, s=6, col=WHITE, eye=(10, 16, 34)):
    px = ['.######.', '########', '##e##e##', '##e##e##', '########', '########', '#.##.##.', '..#..#..']
    for j, row in enumerate(px):
        for i, c in enumerate(row):
            if c != '.': d.rectangle([x + i * s, y + j * s, x + i * s + s - 1, y + j * s + s - 1], fill=eye if c == 'e' else col)

def screen(t):
    im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
    d.rectangle([8, 8, W - 9, H - 9], fill=PANEL, outline=RIM, width=6)
    d.rectangle([50, 40, W - 50, 130], fill=BG, outline=LINE, width=4)
    n = int(max(t, 0) / 0.022)                      # typing: ~45 chars/s
    caret = '_' if (t * 3) % 1 < 0.6 else ' '
    d.text((80, 58), '> ' + CMD[:n] + caret, font=f(48), fill=WHITE)
    for i, name in enumerate(AGENTS):
        ti = (t - len(CMD) * 0.022 - 0.2 - i * 0.12) / 0.8   # rows start once the command is typed
        if ti < 0: continue
        y = 170 + i * 125
        d.line([50, y + 108, W - 50, y + 108], fill=LINE, width=3)
        ghost_icon(d, 80, y + 10, 10)
        d.text((210, y + 22), name, font=f(52), fill=WHITE)
        d.rectangle([1040, y + 30, 1400, y + 70], outline=LINE, width=3)
        d.rectangle([1046, y + 36, 1046 + int(348 * min(1, ti)), y + 64], fill=ORANGE)
    return im

def code(seed=1, w=640, h=400):
    r = random.Random(seed); im = Image.new('RGB', (w, h), (5, 10, 24)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, 26], fill=(16, 30, 64))
    cols = [(120, 190, 255), (200, 220, 255), (255, 170, 60), (110, 230, 170), (255, 110, 130)]
    for j in range(15):
        x = 24 + 28 * r.choice([0, 0, 1, 1, 2, 3]); y = 44 + j * 23
        for _ in range(r.randint(1, 4)):
            l = r.randint(20, 110); d.rectangle([x, y, x + l, y + 9], fill=r.choice(cols)); x += l + 12
    return im

CODE = """# haunted_crew/agents.py
from kiro import spec, crew

@crew("Haunted Crew")
def haunt(world):
    plan = Planner.spec(world)
    code = Coder.build(plan)
    Tester.check(code)
    Deployer.ship(code)
    return "boo!"

haunt("minecraft")"""

def typed(n, w=640, h=400):
    """hero monitor: first n characters of CODE typed, with a caret"""
    im = Image.new('RGB', (w, h), (5, 10, 24)); d = ImageDraw.Draw(im); d.rectangle([0, 0, w, 26], fill=(16, 30, 64)); left = n
    for j, ln in enumerate(CODE.split('\n')):
        if left < 0: break
        col = GREY if ln[:1] == '#' else ORANGE if ln[:1] == '@' else (120, 190, 255) if ln.split(' ')[0] in ('from', 'def') else WHITE
        d.text((20, 40 + j * 27), ln[:left] + ('_' if left <= len(ln) else ''), font=f(20), fill=col); left -= len(ln) + 1
    return im

def blueprint(w=640, h=440):
    im = Image.new('RGB', (w, h), (8, 30, 90)); d = ImageDraw.Draw(im); c = (120, 190, 255)
    for x in range(0, w, 40): d.line([x, 0, x, h], fill=(14, 44, 120))
    for y in range(0, h, 40): d.line([0, y, w, y], fill=(14, 44, 120))
    d.rectangle([4, 4, w - 5, h - 5], outline=c, width=6)
    bx = [(60, 60), (260, 60), (460, 60), (160, 250), (380, 250)]
    for x, y in bx: d.rectangle([x, y, x + 120, y + 90], outline=c, width=6); d.rectangle([x + 24, y + 30, x + 96, y + 60], outline=c, width=4)
    for a, b in [(0, 1), (1, 2)]: d.line([bx[a][0] + 120, 105, bx[b][0], 105], fill=c, width=6)
    for a, b in [(0, 3), (1, 3), (1, 4), (2, 4)]: d.line([bx[a][0] + 60, 150, bx[a][0] + 60, 200, bx[b][0] + 60, 200, bx[b][0] + 60, 250], fill=c, width=6)
    return im

def deploy():
    px = ['................', '................', '.....####.......', '....#....##.....', '..###......#....', '.#.....##...##..', '#.....####....#.',
          '#....######...#.', '#......##.....#.', '.#.....##....#..', '..###..##..##...', '.......##.......', '.......##.......', '................', '................', '................']
    im = Image.new('RGB', (16, 16), (20, 10, 2))
    for j, row in enumerate(px):
        for i, ch in enumerate(row):
            if ch == '#': im.putpixel((i, j), (255, 170, 40))
    return im

def web(n=64):
    """radial pixel spider web, white on transparent"""
    S = n * 8; im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im); c = S / 2; col = (215, 225, 255, 255)
    spokes = [i * math.pi / 4 + 0.2 for i in range(8)]
    for a in spokes: d.line([c, c, c + c * math.cos(a), c + c * math.sin(a)], fill=col, width=7)
    for r in (0.2, 0.4, 0.62, 0.86):
        for i in range(8):
            a, b = spokes[i], spokes[(i + 1) % 8] + (2 * math.pi if i == 7 else 0); m = (a + b) / 2
            p = [(c + c * r * k * math.cos(x), c + c * r * k * math.sin(x)) for x, k in ((a, 1), (m, 0.8), (b, 1))]
            d.line(p, fill=col, width=7)
    return im.resize((n, n), Image.BOX).point(lambda v: 255 if v > 70 else 0)

if __name__ == '__main__':
    out, frames, fps = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
    os.makedirs(out, exist_ok=True)
    for i in range(frames): screen(i / fps).save(os.path.join(out, f'screen_{i + 1:04d}.png'))
    assert f(48).getlength('> ' + CMD + '_') < W - 160 and max(f(26).getlength(l) for l in CODE.split('\n')) < 600   # text fits its box
    for n in range(len(CODE) + 1): typed(n).save(os.path.join(out, f'typed_{n:03d}.png'))
    for s in (1, 2, 3): code(s).save(os.path.join(out, f'code{s}.png'))
    blueprint().save(os.path.join(out, 'blueprint.png')); deploy().save(os.path.join(out, 'deploy.png')); web().save(os.path.join(out, 'web.png'))
