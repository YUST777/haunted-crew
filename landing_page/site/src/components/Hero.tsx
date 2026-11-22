import { Ghosts } from './Ghosts';
import { SetupCard } from './SetupCard';
import { TrailerPlayer } from './TrailerPlayer';

export function Hero() {
  return (
    <section className="hero" id="home" aria-labelledby="hero-title">
      <div className="hero-bg" aria-hidden="true" />
      <div className="hero-fog" aria-hidden="true">
        <span />
        <span />
      </div>
      <Ghosts />
      <div className="hero-content">
        <h1 id="hero-title" className="hero-title">
          <span className="sr-only">Your AI crew, in the Overworld</span>
          <img className="hero-title-line line-1" src="/assets/hero-title-line1.webp" alt="" width={540} height={66} decoding="async" fetchPriority="high" />
          <img className="hero-title-line line-2" src="/assets/hero-title-line2.webp" alt="" width={640} height={65} decoding="async" fetchPriority="high" />
        </h1>
        <p className="hero-tagline">Your agents, haunting Minecraft.</p>
        <p className="hero-sub">Turn your coding agents into helpful ghosts inside a haunted office.</p>
        <div className="hero-showcase">
          <div className="showcase-slot">
            <TrailerPlayer />
          </div>
          <SetupCard />
        </div>
      </div>
      <div className="hero-vignette" aria-hidden="true" />
    </section>
  );
}
