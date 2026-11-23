import { useState } from 'react';

const ID = 'azKBCWLgLLo';

// Click-to-load YouTube embed: the page ships only a thumbnail, and the iframe (and YouTube's
// scripts) load when someone presses play, so the trailer costs nothing on first load.
export function TrailerPlayer() {
  const [on, setOn] = useState(false);

  return (
    <div className="player">
      {on ? (
        <iframe
          className="showcase-video"
          src={`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0&modestbranding=1`}
          title="Haunted Crew trailer"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        <>
          <img className="showcase-video" src={`https://i.ytimg.com/vi_webp/${ID}/maxresdefault.webp`} alt="" width={1280} height={720} decoding="async" fetchPriority="high" />
          <button type="button" className="player-play" onClick={() => setOn(true)} aria-label="Play trailer">
            <svg viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
              <path fill="currentColor" d="M5 2h2v1h1v1h1v1h1v1h1v1h1v2h-1v1h-1v1h-1v1H8v1H7v1H5z" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
