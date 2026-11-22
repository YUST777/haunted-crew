"""Writes index.html: the Haunted Crew workflow run in the OpenBot workflow style (dark canvas, labelled cards, curved wires, Run step buttons)."""
NODES = [  # id, x, y, type label, ghost image, ghost name, model, prompt, result html
 ('t', 0, 0, 'Trigger', None, None, None, None, None),
 ('a1', 660, -40, 'Agent', 'docs', 'Ref Artist', 'ChatGPT Image 2.5', 'Draw a reference sheet for the block: three views, colours, cut stages.', '<img src="assets/refsheet.webp" class="rimg">'),
 ('a2', 1320, 0, 'Agent', 'planner', 'Showrunner', 'Opus 5.5', 'Plan a 26 s ASMR short from the ref sheet: hook, the cut, the payoff.', '<img src="assets/storyboard.webp" class="rimg">'),
 ('a3', 1980, -40, 'Agent', 'researcher', 'Researchers x15', 'Haiku 5.5', 'Scan Reddit, YouTube, GitHub and X for what is trending this week.',
  '<div class="srcs">' + ''.join(f'<span class="src"><img src="assets/chip{k}.png">{n}</span>' for k, n in enumerate(('Reddit', 'YouTube', 'GitHub', 'X'))) + '</div><div class="rt">block-cutting ASMR is up this week</div>'),
 ('b', 330, 700, 'Agent', 'coder', 'Builder', 'Opus 5.5 + Blender MCP', 'Build the scene in Blender from the ref sheet and the storyboard.', '<img src="assets/scene.png" class="rimg">'),
 ('p', 990, 740, 'Agent', 'tester', 'Preview', 'Colab CLI, free T4', 'Render a 240p test on Colab so it costs nothing.', '<img src="assets/scene240.png" class="rimg px"><span class="pill">240p</span>'),
 ('ap', 1650, 700, 'Approval', None, None, None, None, None),
 ('w', 2310, 740, 'Agent', 'reviewer', 'Render Watcher', 'Haiku 5.5', 'Watch the full Colab render, check every 15 min, send it when done.', '<div class="pbar"><i id="wbar"></i></div><div class="rt" id="wtxt">frames 0 / 624</div>'),
]
WIRES = [('t', 'a1'), ('a1', 'a2'), ('a2', 'a3'), ('a3', 'b'), ('b', 'p'), ('p', 'ap'), ('ap', 'w')]
ICON = {'Trigger': '◷', 'Agent': '▢', 'Approval': '✓', 'Output': '➤'}
def card(nid, x, y, typ, g, gn, model, prompt, result):
    lab = f'<div class="lab">{ICON[typ]}  {typ}</div>'
    if nid == 't':
        inner = ('<div class="row"><span class="k">Idea</span><span class="v" id="idea">jelly slime block: 1 cut, 10,648 pieces</span></div>'
                 '<div class="row"><span class="k">Format</span><span class="chip2">Short</span><span class="chip2">9:16</span><span class="chip2">26 s</span></div>'
                 '<div class="row"><span class="k">Workflow</span><span class="v">Blender short</span></div>')
        btn = '<div class="btn b0 white" id="runnow">Run now  ▷</div><div class="btn b2">✓  Started</div>'
        return f'<div class="node" id="{nid}" style="left:{x}px;top:{y}px">{lab}<div class="card"><div class="inner">{inner}</div>{btn}</div></div>'
    if nid == 'ap':
        inner = '<div class="q">Preview looks good? Render the full 1080p reel.</div>'
        btn = '<div class="btn b0 white" id="apbtn">Approve  ✓</div><div class="btn b2">✓  Approved</div>'
        return f'<div class="node" id="{nid}" style="left:{x}px;top:{y}px">{lab}<div class="card"><div class="inner">{inner}</div>{btn}</div></div>'
    inner = (f'<div class="pr">{prompt}</div><div class="foot"><span class="ag"><img src="assets/crew-{g}.webp">{gn} ▾</span><span class="md"><i>◆</i>{model} ▾</span></div>')
    res = f'<div class="res"><div class="rl">Result</div><div class="wait">Waiting...</div><div class="rc">{result}</div></div>'
    btn = '<div class="btn b0">Run step  ▷</div><div class="btn b1"><i class="sp"></i>Running...</div><div class="btn b2">✓  Done</div>'
    return f'<div class="node" id="{nid}" style="left:{x}px;top:{y}px">{lab}<div class="card"><div class="inner">{inner}</div>{res}{btn}</div></div>'
cards = ''.join(card(*n) for n in NODES)
ports = ''.join(f'<i class="port" id="po-{a}"></i><i class="port" id="pi-{b}"></i>' for a, b in WIRES)
paths = ''.join(f'<path class="wd" id="wd{k}"/><path class="wf" id="wf{k}"/>' for k in range(len(WIRES)))
html = '''<!doctype html>
<html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<style>
@font-face{font-family:'PS2';src:url('assets/fonts/press-start-2p.ttf')}
body{margin:0;background:#0e0e0f}
#root{position:absolute;inset:0;overflow:hidden;background:#0e0e0f;font-family:'Inter';color:#d9d9db}
#cam{position:absolute;left:0;top:0;width:10px;height:10px;transform-origin:0 0}
#grid{position:absolute;left:-1600px;top:-1400px;width:7000px;height:4200px;background-image:radial-gradient(rgba(255,255,255,.09) 1.6px,transparent 1.6px);background-size:30px 30px}
svg#wires{position:absolute;left:-1600px;top:-1400px;width:7000px;height:4200px;overflow:visible}
.wd{fill:none;stroke:#5b5b60;stroke-width:3;stroke-dasharray:10 9}
.wf{fill:none;stroke:#c9a8ff;stroke-width:4}
.port{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:#262628;border:2px solid #3a3a3d}
.port::after{content:'';position:absolute;left:11px;top:11px;width:8px;height:8px;border-radius:2px;background:#9a9aa0}
.node{position:absolute;width:500px}
.lab{font-size:20px;color:#8c8c92;margin:0 0 10px 6px}
.card{background:#19191a;border:1px solid #2a2a2d;border-radius:22px;padding:14px;box-shadow:0 20px 50px rgba(0,0,0,.5)}
.inner{background:#222224;border-radius:14px;padding:18px}
.pr{font-size:23px;line-height:33px;color:#dcdcde;min-height:100px}
.foot{display:flex;justify-content:space-between;margin-top:14px;font-size:20px;color:#cfcfd3}
.ag img{width:30px;height:30px;object-fit:contain;vertical-align:middle;margin-right:8px}
.md i{font-style:normal;color:#7CFF9B;margin-right:8px}
.row{display:flex;align-items:center;gap:12px;margin:6px 0 14px;font-size:22px}
.k{width:110px;color:#8c8c92}.v{color:#fff;background:#2c2c2f;border-radius:8px;padding:6px 12px}
.chip2{background:#2c2c2f;border-radius:8px;padding:6px 12px;color:#fff}
.q{font-size:24px;line-height:34px;color:#e9e9eb}
.res{background:#1d1d1f;border:1px solid #29292c;border-radius:14px;padding:14px 16px;margin-top:12px;position:relative;min-height:60px}
.rl{font-size:18px;color:#8c8c92;margin-bottom:8px}.wait{font-size:20px;color:#6b6b70}
.rc{opacity:0}
.rimg{width:440px;height:248px;object-fit:cover;border-radius:10px;display:block}
.rimg.px{image-rendering:pixelated}
.pill{position:absolute;right:28px;bottom:26px;background:#4fa3ff;color:#06121f;font-weight:700;font-size:16px;padding:4px 10px;border-radius:8px}
.srcs{display:flex;gap:10px;flex-wrap:wrap}.src{display:flex;align-items:center;gap:6px;background:#2a2a2d;border-radius:10px;padding:4px 10px 4px 4px;font-size:19px}
.src img{width:34px;height:34px}.rt{font-size:20px;color:#7CFF9B;margin-top:10px}
.pbar{height:16px;border-radius:8px;background:#2c2c2f;overflow:hidden}.pbar i{display:block;width:100%;height:100%;background:#c9a8ff;transform-origin:0 50%}
.btn{height:56px;border-radius:14px;margin-top:12px;font-size:22px;font-weight:600;line-height:56px;text-align:center;background:#2a2a2d;color:#9a9aa0}
.btn.white{background:#f1f1f2;color:#141416}
.b1,.b2{position:absolute;left:14px;right:14px;bottom:14px;margin:0;opacity:0}
.card{position:relative}
.b1{background:#2a2a2d;color:#e6e6e8}.b2{background:#1c2a20;color:#6fd38a}
.sp{display:inline-block;width:16px;height:16px;border:3px solid #e6e6e8;border-top-color:transparent;border-radius:50%;margin-right:10px;vertical-align:-2px}
#cur{position:absolute;left:0;top:0;z-index:20}
#toast{position:absolute;left:1360px;top:40px;width:520px;height:110px;background:rgba(40,40,44,.97);border:1px solid #3a3a3d;border-radius:20px;box-shadow:0 20px 50px rgba(0,0,0,.5);opacity:0}
#toast img{position:absolute;left:16px;top:14px;width:46px;height:82px;object-fit:cover;border-radius:8px}
#toast .a{position:absolute;left:78px;top:24px;font-size:23px;font-weight:700;color:#fff}#toast .b{position:absolute;left:78px;top:60px;font-size:20px;color:#a9a9af}
#badge{position:absolute;left:0;top:968px;width:1920px;text-align:center;opacity:0}
#badge span{display:inline-block;padding:16px 34px;background:#19191a;border:1px solid #3a3a3d;border-radius:18px;font-family:'PS2';font-size:22px;color:#fff}
</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="15" data-width="1920" data-height="1080">
<div id="cam" data-layout-allow-overflow data-layout-ignore><div id="grid"></div><svg id="wires" viewBox="-1600 -1400 7000 4200">PATHS</svg>CARDSPORTS</div>
<div id="toast"><img src="assets/reel.png"><div class="a">Your reel is ready</div><div class="b">Jelly Slime Block, 26 s, rendered free</div></div>
<div id="badge"><span>1 IDEA  >  FINISHED REEL  ·  AUTOMATED IN <span style="padding:0;border:0;background:none;color:#7CFF9B;font-size:22px">KIRO</span></span></div>
<div id="cur" data-layout-allow-occlusion data-layout-allow-overflow data-layout-ignore><svg width="34" height="44" viewBox="0 0 17 22"><path d="M1 1v17l4.5-4.2 3 6.5 3-1.4-3-6.3h6z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg></div>
</div>
<script>
const tl = gsap.timeline({ paused: true });
const W = WIRESJS, IDS = IDSJS;
// measure the laid-out graph (cam at identity) for wires, ports and camera targets
const box = {}; IDS.forEach(id => { const e = document.getElementById(id); box[id] = { x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight }; });
const portY = id => box[id].y + 92;
W.forEach(([a, b], k) => {
  const x1 = box[a].x + box[a].w, y1 = portY(a), x2 = box[b].x, y2 = portY(b), dx = Math.max(140, Math.abs(x2 - x1) * .45);
  const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  document.getElementById('wd' + k).setAttribute('d', d); document.getElementById('wf' + k).setAttribute('d', d);
  const L = document.getElementById('wf' + k).getTotalLength(); gsap.set('#wf' + k, { strokeDasharray: L, strokeDashoffset: L });
  gsap.set('#po-' + a, { left: x1, top: y1 }); gsap.set('#pi-' + b, { left: x2, top: y2 });
});
const centre = id => [box[id].x + box[id].w / 2, box[id].y + box[id].h / 2];
const camv = (cx, cy, s) => ({ x: 960 - cx * s, y: 560 - cy * s, scale: s });
let camState = camv(1350, 450, .44);
const look = (ids, t, s, d = .75) => { const cs = ids.map(centre), cx = cs.reduce((a, c) => a + c[0], 0) / cs.length, cy = cs.reduce((a, c) => a + c[1], 0) / cs.length;
  camState = camv(cx, cy, s); tl.to('#cam', { ...camState, duration: d, ease: 'power2.inOut' }, t); return camState; };
const screenOf = (sel, cs) => { const e = document.querySelector(sel), n = e.closest('.node'); let x = e.offsetLeft + e.offsetWidth * .6, y = e.offsetTop + e.offsetHeight * .6, p = e.offsetParent;
  while (p && p.id !== 'cam') { x += p.offsetLeft; y += p.offsetTop; p = p.offsetParent; } return { x: cs.x + x * cs.scale, y: cs.y + y * cs.scale }; };
gsap.set('#cam', camState); gsap.set('.node', { opacity: 0, y: 30 }); gsap.set(['.port', '.wd'], { opacity: 0 }); gsap.set('#idea', { clipPath: 'inset(0 100% 0 0)' });
gsap.set('#cur', { x: 1000, y: 1150 }); gsap.set('.pbar i', { scaleX: 0 });
// the graph assembles, then the camera drops onto the trigger
IDS.forEach((id, i) => tl.to('#' + id, { opacity: 1, y: 0, duration: .35, ease: 'expo.out' }, .1 + i * .09));
tl.to(['.port', '.wd'], { opacity: 1, duration: .3 }, .7);
const c0 = look(['t'], 1.1, 1.05, .8);
tl.to('#idea', { clipPath: 'inset(0 0% 0 0)', duration: .7, ease: 'steps(38)' }, 1.5);
// click Run now
const rn = screenOf('#runnow', c0); tl.to('#cur', { x: rn.x, y: rn.y, duration: .55, ease: 'power3.out' }, 1.9);
tl.to('#cur', { scale: .85, duration: .08 }, 2.5); tl.to('#cur', { scale: 1, duration: .1 }, 2.58);
tl.to('#t .b2', { opacity: 1, duration: .12 }, 2.55); tl.to('#t .b0', { opacity: 0, duration: .12 }, 2.55);
tl.to('#cur', { x: 1100, y: 1150, duration: .5, ease: 'power2.in' }, 2.8);
const flow = (k, t) => tl.to('#wf' + k, { strokeDashoffset: 0, duration: .45, ease: 'power1.inOut' }, t);
const run = (id, t, d) => {
  tl.to(`#${id} .b0`, { opacity: 0, duration: .1 }, t); tl.to(`#${id} .b1`, { opacity: 1, duration: .1 }, t);
  tl.fromTo(`#${id} .sp`, { rotation: 0 }, { rotation: 360 * Math.ceil(d / .6), duration: d, ease: 'none', immediateRender: false }, t);
  tl.to(`#${id} .wait`, { opacity: 0, duration: .1 }, t + d * .45); tl.fromTo(`#${id} .rc`, { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: .4, immediateRender: false }, t + d * .45);
  tl.to(`#${id} .b1`, { opacity: 0, duration: .1 }, t + d); tl.to(`#${id} .b2`, { opacity: 1, duration: .1 }, t + d);
};
flow(0, 2.6); look(['t', 'a1'], 2.6, .8);
run('a1', 3.0, 1.0); flow(1, 4.0); look(['a1', 'a2'], 3.9, .8);
run('a2', 4.4, 1.0); flow(2, 5.4); look(['a2', 'a3'], 5.3, .8);
run('a3', 5.8, .9); tl.fromTo('#a3 .src', { opacity: .25 }, { opacity: 1, duration: .2, stagger: .15, immediateRender: false }, 6.0);
flow(3, 6.7); look(['b', 'p'], 6.8, .8, .9);
run('b', 7.3, .9); flow(4, 8.2);
run('p', 8.5, .7); flow(5, 9.2); const c5 = look(['p', 'ap'], 8.9, .8);
// you approve
const ab = screenOf('#apbtn', c5); tl.to('#cur', { x: ab.x, y: ab.y, duration: .5, ease: 'power3.out' }, 9.3);
tl.to('#cur', { scale: .85, duration: .08 }, 9.85); tl.to('#cur', { scale: 1, duration: .1 }, 9.93);
tl.to('#ap .b2', { opacity: 1, duration: .12 }, 9.9); tl.to('#ap .b0', { opacity: 0, duration: .12 }, 9.9);
tl.to('#cur', { x: 900, y: 1150, duration: .5, ease: 'power2.in' }, 10.1);
flow(6, 10.0); look(['ap', 'w'], 10.1, .8);
run('w', 10.4, 1.5); tl.to('.pbar i', { scaleX: 1, duration: 1.3, ease: 'power1.inOut' }, 10.5);
tl.to({ f: 0 }, { f: 624, duration: 1.3, ease: 'power1.inOut', onUpdate() { document.getElementById('wtxt').textContent = 'frames ' + Math.round(this.targets()[0].f) + ' / 624'; } }, 10.5);
tl.fromTo('#toast', { opacity: 0, y: -30 }, { opacity: 1, y: 0, duration: .45, ease: 'expo.out', immediateRender: false }, 12.0);
look(['t', 'a3', 'w', 'b'], 12.3, .43, 1.1);
tl.fromTo('#badge', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: .5, ease: 'expo.out', immediateRender: false }, 13.1);
window.__timelines["main"] = tl;
</script>
</body></html>
'''
import json
html = html.replace('PATHS', paths).replace('CARDSPORTS', cards + ports).replace('WIRESJS', json.dumps(WIRES)).replace('IDSJS', json.dumps([n[0] for n in NODES]))
open(__file__.replace('gen.py', 'index.html'), 'w').write(html)
print('ok')
