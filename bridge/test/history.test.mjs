import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistory } from '../src/history.mjs';

let clock = 1000;
const ev = (over = {}) => ({ id: `e${clock}`, ts: clock++, kind: 'prompt', session: 's1', agent: 'ghost', ...over });

test('search returns newest first and ranks by recency', () => {
  const h = createHistory();
  h.record(ev({ id: 'a', text: 'deploy the bridge' }));
  h.record(ev({ id: 'b', text: 'deploy failed' }));
  h.record(ev({ id: 'c', text: 'unrelated chatter' }));
  assert.deepEqual(h.search('deploy').map((r) => r.id), ['b', 'a']);
  assert.deepEqual(h.search('deploy', { limit: 1 }).map((r) => r.id), ['b']);
});

test('query words are ANDed and matching is case-insensitive', () => {
  const h = createHistory();
  h.record(ev({ id: 'a', text: 'Alpha only' }));
  h.record(ev({ id: 'b', text: 'alpha and BETA' }));
  assert.deepEqual(h.search('ALPHA beta').map((r) => r.id), ['b']);
  assert.deepEqual(h.search('alpha gamma'), []);
  assert.deepEqual(h.search('   '), []);
});

test('search also matches tool and file, and snippet is bounded around the match', () => {
  const h = createHistory();
  h.record(ev({ id: 'a', tool: 'fs_write', file: 'src/mailbox.mjs' }));
  h.record(ev({ id: 'b', text: 'x'.repeat(300) + ' needle ' + 'y'.repeat(300) }));
  assert.deepEqual(h.search('mailbox').map((r) => r.id), ['a']);
  const [hit] = h.search('needle');
  assert.equal(hit.id, 'b');
  assert.ok(hit.snippet.includes('needle'));
  assert.ok(hit.snippet.length <= 160);
});

test('agent filter is case-insensitive exact match', () => {
  const h = createHistory();
  h.record(ev({ id: 'a', agent: 'Ghost', text: 'hello' }));
  h.record(ev({ id: 'b', agent: 'ghostly', text: 'hello' }));
  h.record(ev({ id: 'c', agent: 'ghost', text: 'hello' }));
  assert.deepEqual(h.search('hello', { agent: 'GHOST' }).map((r) => r.id), ['c', 'a']);
  assert.deepEqual(h.search('hello', { agent: 'gho' }), []);
});

test('draft events are never recorded', () => {
  const h = createHistory();
  h.record(ev({ id: 'd', kind: 'draft', text: 'secret streaming' }));
  assert.deepEqual(h.search('streaming'), []);
  assert.deepEqual(h.sessions(), []);
});

test('text is truncated to 2000 chars', () => {
  const h = createHistory();
  h.record(ev({ id: 'long', text: 'q'.repeat(2500) }));
  assert.equal(h.read('long').anchor.text.length, 2000);
});

test('read returns a context window from the same session only, in time order', () => {
  const h = createHistory();
  h.record(ev({ id: '1', session: 's1', text: 'one' }));
  h.record(ev({ id: '2', session: 's2', text: 'other' }));
  h.record(ev({ id: '3', session: 's1', text: 'two' }));
  h.record(ev({ id: '4', session: 's2', text: 'other2' }));
  h.record(ev({ id: '5', session: 's1', text: 'three' }));
  h.record(ev({ id: '6', session: 's1', text: 'four' }));
  const r = h.read('3', { before: 1, after: 5 });
  assert.equal(r.anchor.id, '3');
  assert.deepEqual(r.before.map((e) => e.id), ['1']);
  assert.deepEqual(r.after.map((e) => e.id), ['5', '6']);
  assert.equal(h.read('nope'), null);
});

test('sessions summarises per session, newest first, filterable by agent', () => {
  const h = createHistory();
  h.record(ev({ id: '1', session: 'a', agent: 'ghost', ts: 10 }));
  h.record(ev({ id: '2', session: 'b', agent: 'rogue', ts: 20 }));
  h.record(ev({ id: '3', session: 'a', agent: 'ghost', ts: 30 }));
  assert.deepEqual(h.sessions(), [
    { session: 'a', agent: 'ghost', firstTs: 10, lastTs: 30, count: 2 },
    { session: 'b', agent: 'rogue', firstTs: 20, lastTs: 20, count: 1 },
  ]);
  assert.deepEqual(h.sessions({ agent: 'rogue' }).map((s) => s.session), ['b']);
});

test('sessions caps the list at 50', () => {
  const h = createHistory();
  for (let i = 0; i < 55; i++) h.record(ev({ session: `s${i}`, ts: i }));
  assert.equal(h.sessions().length, 50);
});

test('compaction rewrites the file to maxEvents lines once it exceeds 2x', () => {
  const root = mkdtempSync(join(tmpdir(), 'history-compact-'));
  try {
    const file = join(root, '.haunted-crew', 'history.jsonl');
    const h = createHistory({ root, maxEvents: 5 });
    for (let i = 0; i < 10; i++) h.record(ev({ id: `r${i}`, text: `row ${i}` }));
    assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 10);
    h.record(ev({ id: 'r10', text: 'row 10' }));
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 5);
    assert.equal(JSON.parse(lines[0]).id, 'r6');
    assert.equal(h.search('row', { limit: 99 }).length, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed lines are skipped on load and only the last maxEvents are kept', () => {
  const root = mkdtempSync(join(tmpdir(), 'history-bad-'));
  try {
    const dir = join(root, '.haunted-crew');
    mkdirSync(dir, { recursive: true });
    const good = (i) => JSON.stringify({ id: `g${i}`, ts: i, kind: 'prompt', session: 's', text: `ok ${i}` });
    writeFileSync(join(dir, 'history.jsonl'), [good(1), '{not json', good(2), '', 'null', good(3), good(4)].join('\n') + '\n');
    const h = createHistory({ root, maxEvents: 2 });
    assert.deepEqual(h.search('ok', { limit: 99 }).map((r) => r.id), ['g4', 'g3']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('persistence round trip across instances', () => {
  const root = mkdtempSync(join(tmpdir(), 'history-rt-'));
  try {
    const a = createHistory({ root });
    a.record(ev({ id: 'p1', text: 'remember the lantern' }));
    const b = createHistory({ root });
    assert.deepEqual(b.search('lantern').map((r) => r.id), ['p1']);
    assert.equal(b.read('p1').anchor.text, 'remember the lantern');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
