import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEdits, hunk } from '../src/edits.mjs';

test('hunk marks changed lines with context and new-file numbers', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
  const after = ['a', 'b', 'c', 'D', 'x', 'e', 'f', 'g'].join('\n');
  const { lines, added, removed } = hunk(before, after);
  assert.equal(added, 2);
  assert.equal(removed, 1);
  assert.deepEqual(lines.map((l) => l.t + l.text), [' a', ' b', ' c', '-d', '+D', '+x', ' e', ' f', ' g']);
  assert.deepEqual(lines.map((l) => l.n), [1, 2, 3, null, 4, 5, 6, 7, 8]);
});

test('edits: snapshot on tool_start, diff on tool_end, ignores paths outside the root', () => {
  const root = mkdtempSync(join(tmpdir(), 'hc-edits-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/cli.ts'), 'one\ntwo\n');
  const edits = createEdits({ root });
  edits.observe({ kind: 'tool_start', session: 's1', file: 'src/cli.ts' });
  writeFileSync(join(root, 'src/cli.ts'), 'one\n2\n');
  const e = edits.observe({ kind: 'tool_end', session: 's1', id: 'e1', ts: 5 }, { agent: 'Coder' });
  assert.equal(e.file, 'src/cli.ts');
  assert.equal(e.agent, 'Coder');
  assert.equal(e.added, 1);
  assert.equal(edits.recent().length, 1);
  assert.equal(edits.observe({ kind: 'tool_start', session: 's1', file: '../../etc/passwd' }), null);
  assert.equal(edits.observe({ kind: 'tool_end', session: 's1' }), null);
  assert.equal(edits.recent().length, 1);
});
