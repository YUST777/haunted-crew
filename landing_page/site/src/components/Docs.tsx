import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { marked } from 'marked';

const REPO = 'https://github.com/YUST777/haunted-crew';

// The docs live in the repo's /docs folder; the site renders them so there is one source of truth.
const PAGES = import.meta.glob('../../../../docs/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const IMAGES = import.meta.glob('../../../../docs/screenshots/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const byName = (path: string) => path.split('/').pop()!;
const SLUGS = Object.keys(PAGES).map((p) => byName(p).replace(/\.md$/, ''));
const images = Object.fromEntries(Object.entries(IMAGES).map(([p, url]) => [byName(p), url]));

// Sidebar order: the README table order, with the index first.
const ORDER = ['README', 'kiro-integration', 'architecture', 'mod-reference', 'bridge-reference', 'workflows', 'merges', 'screens', 'bridge', 'mod', 'security', 'testing'];
const NAV = ORDER.filter((s) => SLUGS.includes(s));
const LABEL: Record<string, string> = {
  README: 'Overview', 'kiro-integration': 'Kiro integration', architecture: 'Architecture', 'mod-reference': 'Mod reference', 'bridge-reference': 'Bridge reference', workflows: 'Workflows', merges: 'Reviewed merges',
  screens: 'Screens and browser', mod: 'Mod overview', bridge: 'Bridge overview', security: 'Security', testing: 'Testing',
};

function render(md: string) {
  return (marked.parse(md, { async: false }) as string)
    // screenshots/foo.webp -> built asset url
    .replace(/src="screenshots\/([^"]+)"/g, (m, f) => (images[f] ? `src="${images[f]}" loading="lazy"` : m))
    // sibling pages -> site routes
    .replace(/href="([\w-]+)\.md"/g, (_, s) => `href="/docs/${s === 'README' ? '' : s}"`)
    // files outside /docs -> GitHub
    .replace(/href="\.\.\/\.\.\/([^"]+)"/g, `href="${REPO}/blob/main/$1" target="_blank" rel="noreferrer"`)
    .replace(/href="\.\.\/([^"]+)"/g, `href="${REPO}/blob/main/$1" target="_blank" rel="noreferrer"`);
}

export function Docs({ slug }: { slug: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const loader = Object.entries(PAGES).find(([p]) => byName(p) === `${slug}.md`)?.[1];

  useEffect(() => {
    setHtml(null);
    if (!loader) return;
    let live = true;
    loader().then((md) => live && setHtml(render(md)));
    window.scrollTo(0, 0);
    return () => { live = false; };
  }, [loader]);

  return (
    <main className="docs">
      <nav className="docs-nav" aria-label="Documentation">
        <h2>Docs</h2>
        <ul>
          {NAV.map((s) => (
            <li key={s}>
              {s === 'README'
                ? <Link to="/docs" activeOptions={{ exact: true }} activeProps={{ className: 'active' }}>{LABEL[s]}</Link>
                : <Link to="/docs/$page" params={{ page: s }} activeProps={{ className: 'active' }}>{LABEL[s] ?? s}</Link>}
            </li>
          ))}
        </ul>
        <a href={`${REPO}/tree/main/docs`} target="_blank" rel="noreferrer">Edit on GitHub</a>
      </nav>
      <article className="docs-body">
        {!loader ? <p>Page not found. <Link to="/docs">Back to the docs</Link>.</p> : html === null ? <p>Loading…</p> : <div dangerouslySetInnerHTML={{ __html: html }} />}
      </article>
    </main>
  );
}
