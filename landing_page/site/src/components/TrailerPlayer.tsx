import { useRef, useState } from 'react';

// Minimal player: click the video to play/pause, a thin progress line, mute and fullscreen.
export function TrailerPlayer() {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);

  const toggle = () => {
    const v = ref.current;
    if (v) void (v.paused ? v.play() : v.pause());
  };
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = ref.current;
    if (!v || !v.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = ((e.clientX - r.left) / r.width) * v.duration;
  };
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen?.();
  };

  return (
    <div className={`player${playing ? ' is-playing' : ''}`} ref={box}>
      <video
        ref={ref}
        className="showcase-video"
        src="/assets/trailer.webm"
        poster="/assets/trailer-poster.webp"
        width={1280}
        height={720}
        playsInline
        preload="none"
        aria-label="Haunted Crew trailer"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
      />
      <button type="button" className="player-play" onClick={toggle} aria-label={playing ? 'Pause trailer' : 'Play trailer'}>
        <svg viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
          {playing ? <path fill="currentColor" d="M4 3h3v10H4zM9 3h3v10H9z" /> : <path fill="currentColor" d="M5 2h2v1h1v1h1v1h1v1h1v1h1v2h-1v1h-1v1h-1v1H8v1H7v1H5z" />}
        </svg>
      </button>
      <div className="player-bar">
        <div className="player-track" onPointerDown={seek} role="progressbar" aria-label="Trailer progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <i style={{ width: `${progress * 100}%` }} />
        </div>
        <button type="button" onClick={() => { const v = ref.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? 'MUTED' : 'SOUND'}
        </button>
        <button type="button" onClick={fullscreen} aria-label="Fullscreen">FULL</button>
      </div>
    </div>
  );
}
