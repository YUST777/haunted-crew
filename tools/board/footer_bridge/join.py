# Builds the footer art: the parapet + clean panel, plus the props that stand on the parapet
# (stone stack + crystal + books on the left, ghost + banner on the right) cut out with alpha,
# so the top edge isn't a straight line. Coordinates are in result_bridge.png pixels.
from PIL import Image, ImageDraw, ImageFilter
A = 'landing_page/site/public/assets/'
c = Image.open('tools/board/footer_bridge/cellar_source.png').convert('RGB')
c.save(A + 'cellar-v5-2400.webp', quality=88)
c.resize((1280, 720), Image.LANCZOS).save(A + 'cellar-v5-1280.webp', quality=86)

gen = Image.open('tools/board/footer_bridge/result_bridge.png').convert('RGB')
TOP, PARAPET, END = 698, 850, 1370
PROPS = [
    [(30, 850), (30, 745), (88, 745), (88, 698), (174, 698), (174, 745), (165, 745), (165, 782), (180, 782),
     (180, 756), (190, 756), (190, 740), (205, 722), (218, 722), (228, 740), (228, 756), (236, 756), (236, 778),
     (248, 776), (255, 800), (275, 806), (278, 850)],                                  # stones + crystal
    [(292, 850), (292, 822), (302, 822), (302, 800), (320, 800), (320, 783), (404, 783), (404, 800),
     (432, 800), (432, 822), (446, 822), (446, 850)],                                  # books
    [(2096, 850), (2096, 772), (2104, 764), (2164, 764), (2172, 772), (2172, 850)],  # ghost
    [(2190, 850), (2190, 712), (2215, 712), (2215, 705), (2350, 700), (2390, 703), (2395, 742),
     (2357, 742), (2357, 850)],                                                        # banner
]
mask = Image.new('L', gen.size, 0)
d = ImageDraw.Draw(mask)
d.rectangle([0, PARAPET, gen.width, gen.height], fill=255)
for poly in PROPS:
    d.polygon(poly, fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(0.8))
f = gen.convert('RGBA')
f.putalpha(mask)
f = f.crop((0, TOP, 2400, END))
assert f.getpixel((1200, 10))[3] == 0 and f.getpixel((1200, PARAPET - TOP + 5))[3] == 255
f.save(A + 'footer-v4-2400.webp', quality=88)
f.resize((1280, round(1280 * (END - TOP) / 2400)), Image.LANCZOS).save(A + 'footer-v4-1280.webp', quality=86)
print('footer', f.size, 'prop band', PARAPET - TOP)
