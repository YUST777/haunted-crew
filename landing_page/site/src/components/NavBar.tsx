import { Link } from '@tanstack/react-router';
import { useState } from 'react';

const LINKS = [
  { label: 'The crew', href: '/#crew' },
  { label: 'Workflows', href: '/#features' },
  { label: 'About', href: '/#about' },
];

export function GhostIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#f1f2ff" d="M4 1h8v1h1v1h1v10h-1v1h-2v-1h-1v1H6v-1H5v1H3v-1H2V3h1V2h1z" />
      <path fill="#0b0d16" d="M4 5h3v4H4zM9 5h3v4H9z" />
      <path fill="#3dffe2" d="M6 6h1v2H6zM9 6h1v2H9z" />
    </svg>
  );
}

export function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="nav">
      <Link to="/" className="brand" aria-label="Haunted Crew home">
        <span className="brand-icon">
          <GhostIcon />
        </span>
        <span className="brand-name">
          Haunted <span className="accent">Crew</span>
        </span>
      </Link>
      <nav className={menuOpen ? 'nav-menu is-open' : 'nav-menu'} aria-label="Main">
        <button
          className="nav-toggle"
          type="button"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
        <ul className="nav-links" id="primary-navigation">
          <li>
            <Link to="/" onClick={() => setMenuOpen(false)} activeProps={{ className: 'active' }} activeOptions={{ exact: true, includeHash: false }}>
              Home
            </Link>
          </li>
          {LINKS.map((l) => (
            <li key={l.label}>
              <a href={l.href} onClick={() => setMenuOpen(false)}>{l.label}</a>
            </li>
          ))}
          <li>
            <Link to="/docs" onClick={() => setMenuOpen(false)} activeProps={{ className: 'active' }}>Docs</Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
