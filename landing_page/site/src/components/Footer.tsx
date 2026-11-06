import { Link } from '@tanstack/react-router';
import { GhostIcon } from './NavBar';

export function Footer() {
  return (
    <footer className="site-footer" id="about">
      <div className="footer-main">
        <div className="footer-brand-block">
          <Link to="/" className="brand footer-brand" aria-label="Haunted Crew home">
            <span className="brand-icon"><GhostIcon size={28} /></span>
            <span className="brand-name">Haunted <span className="accent">Crew</span></span>
          </Link>
          <p>Your AI crew, haunting Minecraft.</p>
        </div>
      </div>
    </footer>
  );
}
