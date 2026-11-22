"""Cut list shared by cine.py (render), anim_post.py (post) and sfx.py (sound). 24 fps, 20 s."""
FPS = 24
SEQ = [('1', 0, 36), ('2', 36, 78), ('3', 78, 120), ('4', 120, 162), ('5', 162, 204), ('6', 204, 234), ('7', 234, 258), ('8', 258, 288), ('9', 288, 324),
       ('10', 324, 378), ('11', 378, 432), ('12', 432, 480)]
N = SEQ[-1][2]
START = {s: a / FPS for s, a, b in SEQ}
WHIP = {'3': 1, '5': -1, '9': 1}   # shot ends in a whip pan (+1 = to the right); the next shot enters with the same swing
WF = 5                             # whip frames on each side of the cut
SLAM = 1 / 3                       # shot 12: logo lands at this K
PANEL = (.14, .30, .46)            # shot 11: K at which each montage panel has landed

def shot(n): return next(q for q in SEQ if q[1] <= n < q[2])

def whip(n):
    """signed whip amount at frame n: 0..dir while swinging out of a shot, -dir..0 while swinging into the next"""
    i = next(i for i, q in enumerate(SEQ) if q[1] <= n < q[2]); s, a, b = SEQ[i]
    if s in WHIP and n >= b - WF: return WHIP[s] * ((n - (b - WF) + 1) / WF) ** 2
    if i and SEQ[i - 1][0] in WHIP and n < a + WF: return -WHIP[SEQ[i - 1][0]] * (1 - (n - a) / WF) ** 2
    return 0.0

if __name__ == '__main__':
    assert all(SEQ[i][2] == SEQ[i + 1][1] for i in range(len(SEQ) - 1)) and N == 480
    assert whip(119) == 1 and whip(120) == -1 and whip(125) == 0 and whip(100) == 0 and whip(0) == 0
    print('cut ok', N / FPS, 's')
