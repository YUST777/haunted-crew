import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// Live code view for the big screen: snapshots a workspace file when an agent starts a tool on it
// (or the Kiro IDE fires PreToolUse), and diffs it when the tool finishes (or the file is saved).
// Only the project folder is read, read-only; files over MAX_BYTES or binary are skipped.

const MAX_BYTES = 256 * 1024;
const MAX_EDITS = 8;
const CONTEXT = 3;
const MAX_LINES = 40;
const MAX_LCS_CELLS = 250_000;

export function createEdits({ root }) {
  const base = root ? resolve(root) : null;
  const snaps = new Map(); // relative path -> text
  const pending = new Map(); // session -> file of the running tool
  const list = []; // newest first

  function read(rel) {
    if (!base || !rel) return null;
    const file = resolve(base, rel);
    if (file !== base && !file.startsWith(base + sep)) return null;
    try {
      if (statSync(file).size > MAX_BYTES) return null;
      const buf = readFileSync(file);
      if (buf.includes(0)) return null;
      return buf.toString('utf8');
    } catch {
      return null;
    }
  }

  function snap(rel) {
    const text = read(rel);
    if (text !== null) snaps.set(rel, text);
  }

  /** Feed every published event. Returns the new edit, or null. */
  function observe(event, session) {
    if (!base || !event) return null;
    const sid = event.session;
    if (event.kind === 'tool_start') {
      if (event.file) {
        pending.set(sid, event.file);
        if (!snaps.has(event.file)) snap(event.file);
      }
      return null;
    }
    const isEnd = event.kind === 'tool_end' || event.kind === 'file_save' || event.kind === 'file_create';
    if (!isEnd) return null;
    const file = event.file ?? (event.kind === 'tool_end' ? pending.get(sid) : null);
    if (event.kind === 'tool_end') pending.delete(sid);
    if (!file) return null;
    let before = snaps.get(file);
    const after = read(file);
    if (after === null) return null;
    snaps.set(file, after);
    if (before === undefined) {
      if (event.kind !== 'file_create') return null; // never saw it before: nothing to compare
      before = '';
    }
    if (before === after) return null;
    const { lines, added, removed } = hunk(before, after);
    const edit = {
      id: event.id, ts: event.ts ?? Date.now(), session: sid,
      agent: session?.agent ?? event.agent ?? 'Agent', file, lines, added, removed,
    };
    list.unshift(edit);
    list.length = Math.min(list.length, MAX_EDITS);
    return edit;
  }

  return { observe, recent: () => list.slice() };
}

/** Line diff of the changed region with a few lines of context. */
export function hunk(beforeText, afterText) {
  const a = beforeText.split('\n');
  const b = afterText.split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const am = a.slice(p, a.length - s);
  const bm = b.slice(p, b.length - s);

  const ops = [];
  if (am.length * bm.length <= MAX_LCS_CELLS) {
    // LCS table over the changed middle only.
    const n = am.length, m = bm.length;
    const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = am[i] === bm[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) { ops.push([' ', am[i]]); i++; j++; }
      else if (i < n && (j === m || t[i + 1][j] >= t[i][j + 1])) { ops.push(['-', am[i]]); i++; }
      else { ops.push(['+', bm[j]]); j++; }
    }
  } else {
    for (const l of am) ops.push(['-', l]);
    for (const l of bm) ops.push(['+', l]);
  }

  const lines = [];
  let n = Math.max(0, p - CONTEXT); // new-file line index
  for (let k = Math.max(0, p - CONTEXT); k < p; k++) lines.push({ t: ' ', n: ++n, text: b[k] });
  n = p;
  let added = 0, removed = 0;
  for (const [t, text] of ops) {
    if (t === '-') { removed++; lines.push({ t, n: null, text }); }
    else { if (t === '+') added++; lines.push({ t, n: ++n, text }); }
  }
  for (let k = b.length - s; k < Math.min(b.length, b.length - s + CONTEXT); k++) lines.push({ t: ' ', n: k + 1, text: b[k] });
  for (const l of lines) if (l.text.length > 160) l.text = l.text.slice(0, 157) + '…';
  if (lines.length > MAX_LINES) {
    // Keep the start of the change: that's what the agent just did.
    const first = lines.findIndex((l) => l.t !== ' ');
    const from = Math.max(0, Math.min(first - CONTEXT, lines.length - MAX_LINES));
    return { lines: lines.slice(from, from + MAX_LINES), added, removed };
  }
  return { lines, added, removed };
}
