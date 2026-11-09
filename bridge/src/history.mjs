import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const TEXT_MAX = 2000;
const SNIPPET_MAX = 160;
const SESSIONS_MAX = 50;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Durable, searchable log of agent events (OpenBot history_search / history_read).
// Persisted as JSON lines; root falsy = memory only. Sync on purpose: called from the event path.
export function createHistory({ root, maxEvents = 5000 } = {}) {
  const file = root ? join(root, '.haunted-crew', 'history.jsonl') : null;
  let events = [];
  let fileLines = 0;
  let dirReady = false;

  function compact() {
    const tmp = file + '.tmp';
    writeFileSync(tmp, events.map((e) => JSON.stringify(e) + '\n').join(''));
    renameSync(tmp, file);
    fileLines = events.length;
  }

  function load() {
    if (!file || !existsSync(file)) return;
    const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
    fileLines = lines.length;
    for (const line of lines) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e && typeof e === 'object' && !Array.isArray(e)) events.push(e);
    }
    if (events.length > maxEvents) events = events.slice(-maxEvents);
    if (fileLines > 2 * maxEvents) compact();
  }

  function record(event) {
    if (!event || typeof event !== 'object' || event.kind === 'draft') return;
    const e = { ...event, id: event.id ?? randomUUID(), ts: event.ts ?? Date.now() };
    if (typeof e.text === 'string' && e.text.length > TEXT_MAX) e.text = e.text.slice(0, TEXT_MAX);
    events.push(e);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    if (!file) return;
    if (!dirReady) {
      mkdirSync(dirname(file), { recursive: true });
      dirReady = true;
    }
    appendFileSync(file, JSON.stringify(e) + '\n');
    fileLines++;
    if (fileLines > 2 * maxEvents) compact();
  }

  // Newest first. Every whitespace-separated query word must appear in text, tool or file.
  function search(query, { agent, limit = 10 } = {}) {
    const words = String(query ?? '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const res = words.map((w) => new RegExp(escapeRe(w), 'i'));
    const want = agent ? String(agent).toLowerCase() : null;
    const out = [];
    for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = events[i];
      if (want && String(e.agent ?? '').toLowerCase() !== want) continue;
      const hay = [e.text, e.tool, e.file]
        .filter((v) => v !== undefined && v !== null)
        .map(String)
        .join(' ')
        .replace(/\s+/g, ' ');
      const hits = res.map((re) => hay.search(re));
      if (hits.some((h) => h < 0)) continue;
      const start = Math.max(0, Math.min(...hits) - 60);
      out.push({ id: e.id, ts: e.ts, agent: e.agent, kind: e.kind, snippet: hay.slice(start, start + SNIPPET_MAX) });
    }
    return out;
  }

  // Context around one event, limited to the anchor's own session, in time order.
  function read(id, { before = 3, after = 3 } = {}) {
    const i = events.findIndex((e) => e.id === id);
    if (i < 0) return null;
    const anchor = events[i];
    const same = events.filter((e) => e.session === anchor.session);
    const pos = same.indexOf(anchor);
    return {
      anchor: { ...anchor },
      before: same.slice(Math.max(0, pos - before), pos).map((e) => ({ ...e })),
      after: same.slice(pos + 1, pos + 1 + after).map((e) => ({ ...e })),
    };
  }

  // Newest session first, capped at SESSIONS_MAX.
  function sessions({ agent } = {}) {
    const want = agent ? String(agent).toLowerCase() : null;
    const map = new Map();
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (want && String(e.agent ?? '').toLowerCase() !== want) continue;
      let s = map.get(e.session);
      if (!s) {
        s = { session: e.session, agent: e.agent, firstTs: e.ts, lastTs: e.ts, count: 0 };
        map.set(e.session, s);
      }
      if (s.agent === undefined && e.agent) s.agent = e.agent;
      s.firstTs = e.ts;
      s.count++;
    }
    return [...map.values()].slice(0, SESSIONS_MAX);
  }

  load();
  return { record, search, read, sessions };
}
