import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunStore } from '../src/runstore.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'runstore-'));
const run = (id, over = {}) => ({ id, status: 'done', steps: [], ...over });
const runFile = (root) => join(root, '.haunted-crew', 'runs.json');

test('save upserts by id, keeps newest first, and returns copies', () => {
  const s = createRunStore({});
  s.save(run('a'));
  s.save(run('b'));
  assert.deepEqual(s.load().map((r) => r.id), ['b', 'a']);

  s.save(run('a', { status: 'failed' }));
  assert.deepEqual(s.load().map((r) => r.id), ['b', 'a']);
  assert.equal(s.get('a').status, 'failed');

  s.get('a').status = 'mutated';
  assert.equal(s.get('a').status, 'failed');
  assert.equal(s.get('missing'), undefined);
});

test('save keeps only the newest max runs', () => {
  const s = createRunStore({ max: 3 });
  for (const id of ['a', 'b', 'c', 'd', 'e']) s.save(run(id));
  assert.deepEqual(s.load().map((r) => r.id), ['e', 'd', 'c']);
  assert.equal(s.get('a'), undefined);
});

test('save truncates step output to 4000 chars without touching the input', () => {
  const s = createRunStore({});
  const input = run('big', { steps: [{ id: 's1', status: 'done', output: 'x'.repeat(10000) }] });
  s.save(input);
  assert.equal(s.get('big').steps[0].output.length, 4000);
  assert.equal(input.steps[0].output.length, 10000);
});

test('restart marks running runs and live steps interrupted, and persists it', () => {
  const root = tmp();
  try {
    mkdirSync(join(root, '.haunted-crew'), { recursive: true });
    writeFileSync(
      runFile(root),
      JSON.stringify([
        run('r1', {
          status: 'running',
          steps: [
            { id: 's1', status: 'running' },
            { id: 's2', status: 'waiting' },
            { id: 's3', status: 'done' },
          ],
        }),
        run('r2', { status: 'done', steps: [{ id: 'x', status: 'done' }] }),
      ]),
    );

    const s = createRunStore({ root });
    const r1 = s.get('r1');
    assert.equal(r1.status, 'interrupted');
    assert.equal(r1.error, 'bridge restarted');
    assert.deepEqual(r1.steps.map((x) => x.status), ['interrupted', 'interrupted', 'done']);
    assert.ok(r1.steps[0].endedAt);
    assert.equal(s.get('r2').status, 'done');

    const disk = JSON.parse(readFileSync(runFile(root), 'utf8'));
    assert.equal(disk.find((r) => r.id === 'r1').status, 'interrupted');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('corrupt or missing file starts empty without throwing', () => {
  const root = tmp();
  try {
    assert.deepEqual(createRunStore({ root }).load(), []);

    mkdirSync(join(root, '.haunted-crew'), { recursive: true });
    writeFileSync(runFile(root), '{not json');
    const s = createRunStore({ root });
    assert.deepEqual(s.load(), []);

    s.save(run('ok'));
    assert.deepEqual(JSON.parse(readFileSync(runFile(root), 'utf8')).map((r) => r.id), ['ok']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('persistence round trip survives a new store and remove', () => {
  const root = tmp();
  try {
    const s1 = createRunStore({ root });
    s1.save(run('a'));
    s1.save(run('b'));
    assert.equal(s1.remove('a'), true);
    assert.equal(s1.remove('zzz'), false);

    const s2 = createRunStore({ root });
    assert.deepEqual(s2.load().map((r) => r.id), ['b']);
    assert.equal(s2.get('b').status, 'done');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
