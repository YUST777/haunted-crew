import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

const FEATURES = [
  {
    number: '01',
    title: 'Chain ghosts together',
    description: 'Build a repeatable team flow: plan, build, test, then review.',
  },
  {
    number: '02',
    title: 'Copy a friend’s workflow',
    description: 'Start with a workflow they already made, then adapt the ghosts and steps to your project.',
  },
  {
    number: '03',
    title: 'Run the whole chain',
    description: 'Each ghost becomes a step in the workflow, where you can follow its progress as it works.',
  },
];

const WORKFLOW_STEPS = [
  { id: 'start', role: 'START', title: 'New feature', status: 'your prompt', className: 'workflow-start' },
  { id: 'planner', role: 'PLANNER', title: 'Plan the work', status: 'ghost ready', className: 'workflow-planner' },
  { id: 'coder', role: 'CODER', title: 'Build it', status: 'ghost waiting', className: 'workflow-coder' },
  { id: 'tester', role: 'TESTER', title: 'Check it', status: 'ghost queued', className: 'workflow-tester' },
  { id: 'reviewer', role: 'REVIEWER', title: 'Ship it', status: 'ghost queued', className: 'workflow-reviewer' },
] as const;

type WorkflowId = typeof WORKFLOW_STEPS[number]['id'];
type Point = { x: number; y: number };

const INITIAL_POSITIONS: Record<WorkflowId, Point> = {
  start: { x: 3, y: 6 },
  planner: { x: 51, y: 6 },
  coder: { x: 3, y: 38 },
  tester: { x: 51, y: 38 },
  reviewer: { x: 27, y: 70 },
};

// Redstone dust, like the in-game sprite: a thin, jagged trail of PX-sized red pixels that wanders
// a pixel or two off the line, with dark pixels mixed in and the odd stray speck. Seeded per wire so
// the trail keeps its shape while you drag cards.
const PX = 3;
const DUST_REDS = ['#ff0000', '#ff0000', '#ff1a10', '#e00000', '#c40000', '#9a0000'];

function dustPixels(points: [number, number][], seed: number) {
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const out: { x: number; y: number; fill: string }[] = [];
  const snap = (v: number) => Math.round(v / PX) * PX;
  let lateral = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const horiz = Math.abs(bx - ax) >= Math.abs(by - ay);
    const len = Math.abs(horiz ? bx - ax : by - ay);
    const dir = (horiz ? bx - ax : by - ay) < 0 ? -1 : 1;
    for (let d = 0; d <= len; d += PX) {
      if (rand() < 0.3) lateral = Math.max(-PX, Math.min(PX, lateral + (rand() < 0.5 ? -PX : PX)));
      const along = d * dir;
      const put = (off: number, fill?: string) => out.push({
        x: snap(horiz ? ax + along : ax + off),
        y: snap(horiz ? ay + off : ay + along),
        fill: fill ?? DUST_REDS[Math.floor(rand() * DUST_REDS.length)],
      });
      put(lateral);
      if (rand() < 0.45) put(lateral + (rand() < 0.5 ? -PX : PX));
      if (rand() < 0.08) put(lateral + (rand() < 0.5 ? -2 * PX : 2 * PX), '#8a0000');
    }
  }
  return out;
}

const CONNECTIONS: [WorkflowId, WorkflowId][] = [
  ['start', 'planner'],
  ['planner', 'coder'],
  ['coder', 'tester'],
  ['tester', 'reviewer'],
];

export function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  // Ghosts fly in once, the first time the board scrolls into view.
  const [live, setLive] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Partial<Record<WorkflowId, HTMLDivElement>>>({});
  const dragRef = useRef<{
    id: WorkflowId;
    pointerId: number;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);
  const [positions, setPositions] = useState(INITIAL_POSITIONS);
  const [wires, setWires] = useState<[number, number][][]>([]);
  const [size, setSize] = useState({ w: 1000, h: 400 });
  const [activeNode, setActiveNode] = useState<WorkflowId | null>(null);

  const drawWires = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const bounds = canvas.getBoundingClientRect();
    setPositions((current) => {
      let next: typeof current | null = null;
      for (const step of WORKFLOW_STEPS) {
        const node = nodeRefs.current[step.id]?.getBoundingClientRect();
        if (!node) continue;
        const x = Math.max(0, Math.min(current[step.id].x, (bounds.width - node.width) / bounds.width * 100));
        const y = Math.max(0, Math.min(current[step.id].y, (bounds.height - node.height) / bounds.height * 100));
        if (x !== current[step.id].x || y !== current[step.id].y) {
          next ??= { ...current };
          next[step.id] = { x, y };
        }
      }
      return next ?? current;
    });

    setSize({ w: Math.round(bounds.width), h: Math.round(bounds.height) });
    setWires(CONNECTIONS.map(([from, to]) => {
      // Wires run card edge to card edge, so they never hide behind a card or its ghost.
      const fromNode = nodeRefs.current[from]?.querySelector('.node-card')?.getBoundingClientRect();
      const toNode = nodeRefs.current[to]?.querySelector('.node-card')?.getBoundingClientRect();
      const toGhost = nodeRefs.current[to]?.getBoundingClientRect();
      if (!fromNode || !toNode || !toGhost) return [];

      const cx = (r: DOMRect) => r.left + r.width / 2;
      const cy = (r: DOMRect) => r.top + r.height / 2;
      const horizontal = Math.abs(cx(toNode) - cx(fromNode)) >= Math.abs(cy(toNode) - cy(fromNode));
      const right = cx(toNode) >= cx(fromNode);
      const down = cy(toNode) >= cy(fromNode);
      const fromX = horizontal ? (right ? fromNode.right : fromNode.left) : cx(fromNode);
      const fromY = horizontal ? cy(fromNode) : (down ? fromNode.bottom : fromNode.top);
      const toX = horizontal ? (right ? toGhost.left : toNode.right) : cx(toNode);
      const toY = horizontal ? cy(toNode) : (down ? toNode.top : toNode.bottom);
      const x1 = Math.round(fromX - bounds.left);
      const y1 = Math.round(fromY - bounds.top);
      const x2 = Math.round(toX - bounds.left);
      const y2 = Math.round(toY - bounds.top);

      // Redstone dust only runs along the grid: right-angle routes, no curves.
      if (horizontal) {
        const mid = (x1 + x2) / 2;
        return [[x1, y1], [mid, y1], [mid, y2], [x2, y2]];
      }
      const mid = (y1 + y2) / 2;
      return [[x1, y1], [x1, mid], [x2, mid], [x2, y2]];
    }));
  }, []);

  // The first draw comes from the ResizeObserver below (after layout, so no forced reflow at mount);
  // later position changes redraw synchronously.
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    drawWires();
  }, [positions, drawWires]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(drawWires);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawWires]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setLive(true);
      observer.disconnect();
    }, { threshold: 0.3 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  function moveNode(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    const node = drag && nodeRefs.current[drag.id];
    if (!drag || !canvas || !node || event.pointerId !== drag.pointerId) return;

    const bounds = canvas.getBoundingClientRect();
    const nodeBounds = node.getBoundingClientRect();
    setPositions((current) => ({
      ...current,
      [drag.id]: {
        x: Math.max(0, Math.min((bounds.width - nodeBounds.width) / bounds.width * 100, drag.x + (event.clientX - drag.clientX) / bounds.width * 100)),
        y: Math.max(0, Math.min((bounds.height - nodeBounds.height) / bounds.height * 100, drag.y + (event.clientY - drag.clientY) / bounds.height * 100)),
      },
    }));
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLDivElement>, id: WorkflowId) {
    const delta = ({
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    } as const)[event.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'];
    if (!delta || !canvasRef.current || !nodeRefs.current[id]) return;
    event.preventDefault();

    const bounds = canvasRef.current.getBoundingClientRect();
    const nodeBounds = nodeRefs.current[id]!.getBoundingClientRect();
    setPositions((current) => ({
      ...current,
      [id]: {
        x: Math.max(0, Math.min((bounds.width - nodeBounds.width) / bounds.width * 100, current[id].x + delta[0])),
        y: Math.max(0, Math.min((bounds.height - nodeBounds.height) / bounds.height * 100, current[id].y + delta[1])),
      },
    }));
  }

  return (
    <section ref={sectionRef} className={`features-section${live ? ' is-live' : ''}`} id="features" aria-labelledby="features-title">
      <div className="features-inner">
        <div className="mc-board">
        <div className="features-screen">
          <div className="workflow-toolbar">
            <span><i /> WORKFLOW</span>
            <b>Copy friend’s flow</b>
          </div>
          <div className="workflow-canvas" ref={canvasRef} role="group" aria-label="Movable workflow. Use arrow keys to move a selected step.">
            <div className="workflow-grid" aria-hidden="true" />
            <svg className="workflow-wires" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
              {wires.map((wire, index) => (
                <g key={CONNECTIONS[index].join('-')} style={{ animationDelay: `${0.5 + index * 0.25}s` }}>
                  {dustPixels(wire, 11 + index * 97).map((p, i) => <rect key={i} x={p.x} y={p.y} width={PX} height={PX} fill={p.fill} />)}
                </g>
              ))}
            </svg>
            {WORKFLOW_STEPS.map((step) => (
              <div
                key={step.id}
                ref={(node) => { nodeRefs.current[step.id] = node ?? undefined; }}
                className={`workflow-node ${step.className}${activeNode === step.id ? ' is-dragging' : ''}`}
                style={{ left: `${positions[step.id].x}%`, top: `${positions[step.id].y}%`, '--i': WORKFLOW_STEPS.indexOf(step) } as CSSProperties}
                role="group"
                aria-label={`${step.role}: ${step.title}. Drag to move, or use arrow keys.`}
                aria-roledescription="movable workflow step"
                tabIndex={0}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  dragRef.current = {
                    id: step.id,
                    pointerId: event.pointerId,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    x: positions[step.id].x,
                    y: positions[step.id].y,
                  };
                  setActiveNode(step.id);
                }}
                onPointerMove={moveNode}
                onPointerUp={() => { dragRef.current = null; setActiveNode(null); }}
                onPointerCancel={() => { dragRef.current = null; setActiveNode(null); }}
                onLostPointerCapture={() => { dragRef.current = null; setActiveNode(null); }}
                onKeyDown={(event) => moveWithKeyboard(event, step.id)}
              >
                <span className="node-card"><small>{step.role}</small><strong>{step.title}</strong><em>{step.status}</em></span>
              </div>
            ))}
          </div>
        </div>
        </div>
        <div className="features-copy">
          <h2 id="features-title">Workflows<br />as <span>Ghost Crews.</span></h2>
          <p className="features-lede">Turn your workflow into a team of ghosts. Chain them together, or copy a friend’s crew and make it yours.</p>
          <ul className="feature-list">
            {FEATURES.map((feature) => (
              <li key={feature.number}>
                <span className="feature-number">{feature.number}</span>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
