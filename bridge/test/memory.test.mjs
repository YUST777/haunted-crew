import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemory, extract } from '../src/memory.mjs';

test('remember validates agent, text and tags', () => {
  const m = createMemory();
  assert.throws(() => m.remember('', 'hi'), TypeError);
  assert.throws(() => m.remember('ghost', 42), TypeError);
  assert.throws(() => m.remember('ghost', '   '), RangeError);
  assert.throws(() => m.remember('ghost', 'x'.repeat(1001)), RangeError);
  assert.throws(() => m.remember('ghost', 'hi', ['a', 'b', 'c', 'd', 'e', 'f']), RangeError);
  assert.throws(() => m.remember('ghost', 'hi', ['bad tag']), RangeError);
  assert.throws(() => m.remember('ghost', 'hi', ['x'.repeat(25)]), RangeError);
  assert.doesNotThrow(() => m.remember('ghost', 'x'.repeat(1000), ['x'.repeat(24)]));
});

test('remember stores trimmed text and tags, returns id', () => {
  const m = createMemory();
  const { id } = m.remember('ghost', '  likes tabs  ', ['style']);
  const [e] = m.list('ghost');
  assert.equal(e.id, id);
  assert.equal(e.text, 'likes tabs');
  assert.deepEqual(e.tags, ['style']);
  assert.equal(typeof e.ts, 'number');
});

test('duplicate text per agent updates the existing entry', () => {
  const m = createMemory();
  const a = m.remember('ghost', 'Likes Tea');
  const before = m.list('ghost')[0].ts;
  const b = m.remember('ghost', '  likes tea  ');
  assert.equal(b.id, a.id);
  assert.equal(m.list('ghost').length, 1);
  assert.ok(m.list('ghost')[0].ts >= before);
  const c = m.remember('other', 'Likes Tea');
  assert.notEqual(c.id, a.id);
  assert.equal(m.list('other').length, 1);
});

test('search ranks by keyword overlap, ties newest first', () => {
  const m = createMemory();
  m.remember('g', 'deploy script uses docker', ['ops']);
  m.remember('g', 'the cat likes fish');
  m.remember('g', 'docker compose file lives in infra', ['docker']);
  m.remember('g', 'deploy to docker on friday');
  assert.deepEqual(
    m.search('g', 'docker deploy').map((e) => e.text),
    ['deploy to docker on friday', 'deploy script uses docker', 'docker compose file lives in infra'],
  );
  assert.equal(m.search('g', 'ops')[0].text, 'deploy script uses docker');
  assert.deepEqual(m.search('g', 'quantum'), []);
  assert.equal(m.search('g', 'docker', { limit: 1 }).length, 1);
});

test('empty query returns newest first', () => {
  const m = createMemory();
  m.remember('g', 'first');
  m.remember('g', 'second');
  m.remember('g', 'third');
  assert.deepEqual(m.search('g', '').map((e) => e.text), ['third', 'second', 'first']);
});

test('forget only removes the owner agent entry', () => {
  const m = createMemory();
  const { id } = m.remember('alice', 'secret plan');
  assert.deepEqual(m.forget('bob', id), { ok: false });
  assert.equal(m.list('alice').length, 1);
  assert.deepEqual(m.forget('alice', id), { ok: true });
  assert.equal(m.list('alice').length, 0);
  assert.deepEqual(m.forget('alice', id), { ok: false });
});

test('cap keeps 100 per agent and drops the oldest', () => {
  const m = createMemory();
  for (let i = 0; i < 105; i++) m.remember('g', `note ${i}`);
  const all = m.list('g');
  assert.equal(all.length, 100);
  assert.equal(all[0].text, 'note 104');
  assert.ok(!all.some((e) => e.text === 'note 0'));
  assert.ok(all.some((e) => e.text === 'note 5'));
});

test('prelude builds a block and respects maxChars', () => {
  const m = createMemory();
  assert.equal(m.prelude('g', 'anything'), '');
  m.remember('g', 'the cat likes fish');
  assert.equal(m.prelude('g', 'quantum'), '');
  assert.equal(m.prelude('g', 'cat'), 'Things you remember:\n- the cat likes fish');

  const big = createMemory();
  for (let i = 0; i < 10; i++) big.remember('g', `alpha ${i} ${'x'.repeat(990)}`);
  const block = big.prelude('g', 'alpha');
  assert.ok(block.startsWith('Things you remember:\n- '));
  assert.ok(block.length <= 1500);
  assert.ok(big.prelude('g', 'alpha', { maxChars: 100 }).length <= 100);
});

test('extract parses REMEMBER lines with optional tags', () => {
  const reply = [
    'Sure, here you go.',
    'REMEMBER: [style, prefs] user prefers tabs',
    '  REMEMBER: [bad tag,ok] deploys on fridays',
    'remember: lowercase is ignored',
    'REMEMBER:   ',
    'Not REMEMBER: inline',
  ].join('\n');
  assert.deepEqual(extract(reply), [
    { text: 'user prefers tabs', tags: ['style', 'prefs'] },
    { text: 'deploys on fridays', tags: ['ok'] },
  ]);
  assert.deepEqual(extract(undefined), []);
});

test('memory persists across instances via <root>/.haunted-crew/memory.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'memory-test-'));
  const a = createMemory({ root });
  const { id } = a.remember('ghost', 'Prefers dark mode', ['ui']);
  const file = join(root, '.haunted-crew', 'memory.json');
  assert.ok(existsSync(file));
  assert.equal(existsSync(`${file}.tmp`), false);

  const b = createMemory({ root });
  assert.deepEqual(b.list('ghost'), a.list('ghost'));
  assert.equal(b.list('ghost')[0].id, id);
  assert.equal(b.forget('ghost', id).ok, true);
  assert.equal(createMemory({ root }).list('ghost').length, 0);
});

test('memory-only mode works without a root', () => {
  const m = createMemory();
  m.remember('ghost', 'no disk here');
  assert.equal(m.search('ghost', 'disk')[0].text, 'no disk here');
});
