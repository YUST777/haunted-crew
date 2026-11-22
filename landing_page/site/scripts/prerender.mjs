// Prerenders the built SPA into static HTML so readers that do not run JavaScript (AI agents, link previews,
// search engines) see the real page text. Runs after `vite build` (package.json "postbuild").
// Needs Google Chrome (CHROME_PATH overrides). React then re-renders the same content on top in the browser.
import { spawn, execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '../dist');
const docs = readdirSync(join(here, '../../../docs')).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => f.slice(0, -3));
const routes = ['/', '/docs', ...docs.map((d) => `/docs/${d}`)];
const CHROME = process.env.CHROME_PATH || 'google-chrome';
const PORT = 4179;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: join(here, '..'), stdio: 'ignore' });
try {
  for (let i = 0; ; i++) {
    try { await fetch(`http://localhost:${PORT}/`); break; } catch { if (i > 50) throw new Error('vite preview did not start'); await new Promise((r) => setTimeout(r, 200)); }
  }
  for (const route of routes) {
    const html = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=8000', '--dump-dom', `http://localhost:${PORT}${route}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
    const words = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    if (words < 100) throw new Error(`prerender ${route}: only ${words} words, page did not render`);
    const dir = join(dist, route);
    mkdirSync(dir, { recursive: true });
    // Chrome writes injected <link modulepreload> tags with the preview origin; make them site-relative.
    const out = html.replace(/^<!doctype html>/i, '').replaceAll(`http://localhost:${PORT}/`, '/');
    if (out.includes(`localhost:${PORT}`)) throw new Error(`prerender ${route}: localhost URL left in the HTML`);
    writeFileSync(join(dir, 'index.html'), `<!doctype html>\n${out}`);
    console.log(`prerender ${route}: ${words} words`);
  }
} finally {
  server.kill();
}
