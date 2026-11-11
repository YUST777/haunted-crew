// Publishes the repo's /docs as plain markdown so AI agents (which do not run the SPA) can read everything:
//   /llms.txt          index with a one-line summary per page
//   /llms-full.txt     every page in one file
//   /docs/<name>.md    each page as raw markdown
// Runs before `vite build` (see package.json "prebuild"). Output is git-ignored.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../../docs');
const pub = join(here, '../public');
const SITE = 'https://haunted-crew.pages.dev';
const REPO = 'https://github.com/YUST777/haunted-crew';

const ORDER = ['README', 'architecture', 'mod-reference', 'bridge-reference', 'kiro-integration', 'workflows', 'merges', 'screens', 'bridge', 'mod', 'security', 'testing'];
const files = readdirSync(src).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
files.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));

// Screenshots are useless to a text reader: drop the <p><img> wrappers, keep alt text as a caption.
const clean = (md) => md.replace(/<p[^>]*>\s*<img[^>]*alt="([^"]*)"[^>]*>(?:<br>)?(?:<sub>(.*?)<\/sub>)?\s*<\/p>/gs, (_, alt) => `*Screenshot: ${alt}*`)
  .replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, '*Screenshot: $1*');

rmSync(join(pub, 'docs'), { recursive: true, force: true });
mkdirSync(join(pub, 'docs'), { recursive: true });

const pages = files.map((name) => {
  const md = clean(readFileSync(join(src, `${name}.md`), 'utf8'));
  const title = md.match(/^#\s+(.+)$/m)?.[1] ?? name;
  let fence = false;
  const summary = md.split('\n').map((l) => l.trim()).find((l) => {
    if (l.startsWith('```')) { fence = !fence; return false; }
    return !fence && l.length > 50 && !/^[#|<>*\-\d]/.test(l);
  }) ?? '';
  writeFileSync(join(pub, 'docs', `${name}.md`), md);
  return { name, title, summary, md };
});

const intro = `# Haunted Crew

> Haunted Crew turns Kiro coding agents into ghosts in a Minecraft (Fabric, 26.3) mod. A Node bridge talks to Kiro (hooks and the Agent Client Protocol), runs multi-agent workflows in git worktrees with in-game reviewed merges, and streams a headless browser onto in-game screens.

- Source: ${REPO}
- Site: ${SITE}
- Everything below is plain markdown generated from the repository's /docs folder.
`;

writeFileSync(join(pub, 'llms.txt'), `${intro}\n## Documentation\n\n${pages.map((p) => `- [${p.title}](${SITE}/docs/${p.name}.md): ${p.summary.replace(/\*\*/g, '').slice(0, 240)}`).join('\n')}\n\n## Full text\n\n- [All documentation in one file](${SITE}/llms-full.txt)\n`);
writeFileSync(join(pub, 'llms-full.txt'), `${intro}\n${pages.map((p) => `\n---\n\n<!-- page: ${SITE}/docs/${p.name}.md -->\n\n${p.md.trim()}\n`).join('')}`);
console.log(`docs-static: ${pages.length} pages -> llms.txt, llms-full.txt, docs/*.md`);
