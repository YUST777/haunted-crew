import { Link } from '@tanstack/react-router';
import { GhostIcon } from './NavBar';

const REPO = 'https://github.com/YUST777/haunted-crew';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Home', href: '/#home' },
      { label: 'The crew', href: '/#crew' },
      { label: 'Workflows', href: '/#features' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'GitHub', href: REPO },
      { label: 'Docs', href: '/docs' },
      { label: 'Issues', href: `${REPO}/issues` },
    ],
  },
];

export function Footer() {
  return (
    <footer className="site-footer" id="about">
      <div className="footer-panel">
        <div className="footer-brand-block">
          <Link to="/" className="brand footer-brand" aria-label="Haunted Crew home">
            <span className="brand-icon"><GhostIcon size={40} /></span>
            <span className="brand-name">Haunted <span className="accent">Crew</span></span>
          </Link>
          <p>Your AI crew, always on duty.</p>
          <a className="footer-social" href={REPO} target="_blank" rel="noreferrer" aria-label="Haunted Crew on GitHub">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
              />
            </svg>
          </a>
        </div>
        <nav className="footer-columns" aria-label="Footer">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3>{col.title}</h3>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} {...(l.href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}>
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="footer-bottom">
          <span className="footer-rule" aria-hidden="true" />
          <GhostIcon size={22} />
          <span className="footer-rule" aria-hidden="true" />
          <small>© 2026 Haunted Crew. Open source under the <a href="https://github.com/YUST777/haunted-crew/blob/main/LICENSE">MIT license</a>.</small>
        </div>
      </div>
    </footer>
  );
}
