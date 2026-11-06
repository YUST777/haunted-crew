import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

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
    description: 'Each step becomes a ghost in the office, where you can follow its progress as it works.',
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
  start: { x: 4, y: 8 },
  planner: { x: 53, y: 8 },
  coder: { x: 4, y: 39 },
  tester: { x: 53, y: 39 },
  reviewer: { x: 29, y: 70 },
};

const CONNECTIONS: [WorkflowId, WorkflowId][] = [
  ['start', 'planner'],
  ['planner', 'coder'],
  ['coder', 'tester'],
  ['tester', 'reviewer'],
];

export function FeaturesSection() {
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
  const [wires, setWires] = useState<string[]>([]);
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

    setWires(CONNECTIONS.map(([from, to]) => {
      const fromNode = nodeRefs.current[from]?.getBoundingClientRect();
      const toNode = nodeRefs.current[to]?.getBoundingClientRect();
      if (!fromNode || !toNode) return '';

      const fromX = fromNode.left + fromNode.width / 2;
      const fromY = fromNode.top + fromNode.height / 2;
      const toX = toNode.left + toNode.width / 2;
      const toY = toNode.top + toNode.height / 2;
      const horizontal = Math.abs(toX - fromX) >= Math.abs(toY - fromY);
      const x1 = ((fromX - bounds.left) / bounds.width) * 1000;
      const y1 = ((fromY - bounds.top) / bounds.height) * 400;
      const x2 = ((toX - bounds.left) / bounds.width) * 1000;
      const y2 = ((toY - bounds.top) / bounds.height) * 400;

      if (horizontal) {
        const bend = Math.max(24, Math.abs(x2 - x1) * 0.32);
        const c1 = x1 + Math.sign(x2 - x1) * bend;
        const c2 = x2 - Math.sign(x2 - x1) * bend;
        return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
      }

      const bend = Math.max(18, Math.abs(y2 - y1) * 0.32);
      const c1 = y1 + Math.sign(y2 - y1) * bend;
      const c2 = y2 - Math.sign(y2 - y1) * bend;
      return `M ${x1} ${y1} C ${x1} ${c1}, ${x2} ${c2}, ${x2} ${y2}`;
    }));
  }, []);

  useLayoutEffect(() => {
    drawWires();
  }, [positions, drawWires]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(drawWires);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawWires]);

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
    <section className="features-section" id="features" aria-labelledby="features-title">
      <div className="features-inner">
        <div className="features-screen">
          <div className="workflow-toolbar">
            <span><i /> WORKFLOW</span>
            <strong>FEATURE SHIPPER</strong>
            <b>Copy friend’s flow</b>
          </div>
          <div className="workflow-canvas" ref={canvasRef} role="group" aria-label="Movable workflow. Use arrow keys to move a selected step.">
            <div className="workflow-grid" aria-hidden="true" />
            <svg className="workflow-wires" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <defs>
                <linearGradient id="workflow-wire-gradient">
                  <stop stopColor="#5e46a0" />
                  <stop offset="1" stopColor="#4fd4c7" />
                </linearGradient>
              </defs>
              {wires.map((wire, index) => <path key={CONNECTIONS[index].join('-')} d={wire} />)}
            </svg>
            {WORKFLOW_STEPS.map((step) => (
              <div
                key={step.id}
                ref={(node) => { nodeRefs.current[step.id] = node ?? undefined; }}
                className={`workflow-node ${step.className}${activeNode === step.id ? ' is-dragging' : ''}`}
                style={{ left: `${positions[step.id].x}%`, top: `${positions[step.id].y}%` }}
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
                <small>{step.role}</small><strong>{step.title}</strong><em>{step.status}</em>
              </div>
            ))}
          </div>
        </div>
        <div className="features-copy">
          <h2 id="features-title">Workflows that<br />run together.</h2>
          <p className="features-lede">Link ghosts into a repeatable team, or copy a friend’s workflow and make it yours.</p>
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
