import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_TEXT = 1000;
const MAX_TAGS = 5;
const MAX_PER_AGENT = 100;
const TAG_RE = /^[\w-]{1,24}$/;
const WORD_RE = /[\p{L}\p{N}_-]+/gu;
const HEADER = 'Things you remember:';

const words = (s) => new Set(String(s).toLowerCase().match(WORD_RE) ?? []);
const pub = ({ id, text, tags, ts }) => ({ id, text, tags: [...tags], ts });

function checkAgent(agent) {
  if (typeof agent !== 'string' || !agent.trim()) throw new TypeError('agent name must be a non-empty string');
}

function checkTags(tags) {
  if (!Array.isArray(tags)) throw new TypeError('tags must be an array');
  if (tags.length > MAX_TAGS) throw new RangeError(`at most ${MAX_TAGS} tags`);
  for (const t of tags) {
    if (typeof t !== 'string' || !TAG_RE.test(t)) throw new RangeError(`bad tag: ${JSON.stringify(t)}`);
  }
  return [...tags];
}

// Per-agent memory keyed by agent name, so it survives new ghost sessions.
// Each agent's list is kept newest first; the array order is the recency order.
// shortcut: whole file rewritten on each write, fine at 100 entries per agent; upgrade to an append log if that grows.
export function createMemory({ root } = {}) {
  const file = root == null ? null : join(root, '.haunted-crew', 'memory.json');
  const agents = new Map();
  if (file && existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    for (const [name, items] of Object.entries(saved.agents ?? {})) agents.set(name, items);
  }

  function save() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, agents: Object.fromEntries(agents) }, null, 2));
    renameSync(tmp, file);
  }

  function remember(agent, text, tags = []) {
    checkAgent(agent);
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    const clean = text.trim();
    if (clean.length < 1 || clean.length > MAX_TEXT) throw new RangeError(`text must be 1-${MAX_TEXT} chars`);
    const tg = checkTags(tags);

    const items = agents.get(agent) ?? [];
    agents.set(agent, items);
    const key = clean.toLowerCase();
    const i = items.findIndex((e) => e.text.toLowerCase() === key);
    let entry;
    if (i >= 0) {
      [entry] = items.splice(i, 1);
      entry.ts = Date.now();
    } else {
      entry = { id: randomUUID(), text: clean, tags: tg, ts: Date.now() };
    }
    items.unshift(entry);
    items.length = Math.min(items.length, MAX_PER_AGENT);
    save();
    return { id: entry.id };
  }

  function search(agent, query, { limit = 5 } = {}) {
    const items = agents.get(agent) ?? [];
    const n = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 5;
    const q = [...words(query ?? '')];
    if (!q.length) return items.slice(0, n).map(pub);
    const scored = [];
    for (const e of items) {
      const have = words(`${e.text} ${e.tags.join(' ')}`);
      const score = q.filter((w) => have.has(w)).length;
      if (score) scored.push({ e, score });
    }
    // Array.prototype.sort is stable, so equal scores keep newest-first order.
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, n).map(({ e }) => pub(e));
  }

  function forget(agent, id) {
    const items = agents.get(agent) ?? [];
    const i = items.findIndex((e) => e.id === id);
    if (i < 0) return { ok: false };
    items.splice(i, 1);
    save();
    return { ok: true };
  }

  function list(agent) {
    return (agents.get(agent) ?? []).map(pub);
  }

  function prelude(agent, task, { limit = 5, maxChars = 1500 } = {}) {
    const hits = search(agent, task, { limit });
    if (!hits.length) return '';
    let out = HEADER;
    for (const h of hits) {
      const room = maxChars - out.length - 3; // room for "\n- "
      if (room < 10) break;
      const text = h.text.length <= room ? h.text : `${h.text.slice(0, room - 1)}…`;
      out += `\n- ${text}`;
    }
    return out.length > HEADER.length ? out : '';
  }

  return { remember, search, forget, list, prelude };
}

const REMEMBER_RE = /^REMEMBER:\s*(?:\[([^\]]*)\])?\s*(.*)$/;

export function extract(replyText) {
  if (typeof replyText !== 'string') return [];
  const out = [];
  for (const raw of replyText.split(/\r?\n/)) {
    const m = REMEMBER_RE.exec(raw.trim());
    if (!m) continue;
    const text = m[2].trim().slice(0, MAX_TEXT);
    if (!text) continue;
    const tags = (m[1] ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => TAG_RE.test(t))
      .slice(0, MAX_TAGS);
    out.push({ text, tags });
  }
  return out;
}
