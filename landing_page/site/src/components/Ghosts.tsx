import { useEffect, useRef } from 'react';

// The two hero ghosts are flat sprites (public/assets/ghost-*.webp, cut from
// "Voxel Coder and Planner Ghosts.png"). Motion is CSS only: a float loop per ghost, drifting voxel
// sparks, and a small pointer parallax set through the --px / --py custom properties.

type Spark = { x: number; y: number; size: number; delay: number; dur: number };

// Fixed positions (percent of the ghost box) so the layout is the same on every load.
const CODER_SPARKS: Spark[] = [
  { x: 6, y: 62, size: 10, delay: 0, dur: 5.5 },
  { x: 14, y: 78, size: 7, delay: 1.4, dur: 6.2 },
  { x: 22, y: 88, size: 8, delay: 2.6, dur: 5.1 },
  { x: 3, y: 45, size: 6, delay: 3.3, dur: 6.8 },
  { x: 30, y: 95, size: 6, delay: 0.8, dur: 5.8 },
  { x: 80, y: 30, size: 9, delay: 2.0, dur: 6.4 },
];

const PLANNER_SPARKS: Spark[] = [
  { x: 92, y: 66, size: 9, delay: 0.5, dur: 5.6 },
  { x: 84, y: 86, size: 7, delay: 1.9, dur: 6.1 },
  { x: 70, y: 96, size: 7, delay: 3.0, dur: 5.3 },
  { x: 8, y: 40, size: 8, delay: 1.1, dur: 6.6 },
  { x: 96, y: 40, size: 6, delay: 2.7, dur: 5.9 },
  { x: 15, y: 75, size: 6, delay: 3.8, dur: 6.3 },
];

function Sparks({ list, color }: { list: Spark[]; color: string }) {
  return (
    <>
      {list.map((s, i) => (
        <i
          key={i}
          className="spark"
          style={
            {
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              background: color,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.dur}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </>
  );
}

export function Ghosts() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = root.current;
        if (!el) return;
        el.style.setProperty('--px', ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3));
        el.style.setProperty('--py', ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3));
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <div className="ghosts" ref={root} aria-hidden="true">
      <div className="ghost ghost-coder">
        <div className="ghost-float">
          <img src="/assets/ghost-coder.webp" alt="" width={820} height={721} decoding="async" />
        </div>
        <Sparks list={CODER_SPARKS} color="#3df2e0" />
      </div>
      <div className="ghost ghost-planner">
        <div className="ghost-float">
          <img src="/assets/ghost-planner.webp" alt="" width={765} height={804} decoding="async" />
        </div>
        <Sparks list={PLANNER_SPARKS} color="#5ff2a8" />
      </div>
    </div>
  );
}
