import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktrees, isGitRepo, MergeError } from '../src/worktrees.mjs';

const sh = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd }).toString().trim();
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'hcwt-'));
  sh(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('worktree: agent edits stay off the user checkout until the merge is approved', async () => {
  const dir = project();
  assert.equal(await isGitRepo(dir), true);
  const wt = createWorktrees({ repo: dir, store: mkdtempSync(join(tmpdir(), 'hcwt-store-')) });
  const w = await wt.create('run1');
  writeFileSync(join(w.path, 'a.txt'), 'one\ntwo\nthree\nfour\n');
  writeFileSync(join(w.path, 'new.txt'), 'hi\n');
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'one\ntwo\nthree\n'); // untouched
  const s = await wt.finish('run1');
  assert.deepEqual([s.files, s.additions, s.deletions], [2, 2, 0]);
  assert.match(await wt.diff('run1'), /\+four/);
  const before = sh(dir, 'rev-parse', 'HEAD');
  const m = await wt.merge('run1');
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8').endsWith('four\n'), true);
  assert.equal(existsSync(join(dir, 'new.txt')), true);
  assert.notEqual(sh(dir, 'rev-parse', 'HEAD'), before);
  assert.equal(sh(dir, 'rev-list', '--parents', '-1', 'HEAD').split(' ').length, 3); // a real merge commit with two parents
  assert.match(m.sha, /^[0-9a-f]{7}$/);
  assert.equal(existsSync(w.path), false);
});

test('worktree: no changes means nothing to review; reject removes branch and folder', async () => {
  const dir = project();
  const wt = createWorktrees({ repo: dir, store: mkdtempSync(join(tmpdir(), 'hcwt-store-')) });
  const w = await wt.create('run2');
  assert.equal(await wt.finish('run2'), null);
  writeFileSync(join(w.path, 'x.txt'), 'x\n');
  await wt.finish('run2');
  await wt.discard('run2');
  assert.equal(existsSync(w.path), false);
  assert.equal(sh(dir, 'branch', '--list', 'haunted-crew/run2'), '');
});

test('worktree: dirty checkout and conflicts are refused with the reason', async () => {
  const dir = project();
  const wt = createWorktrees({ repo: dir, store: mkdtempSync(join(tmpdir(), 'hcwt-store-')) });
  const w = await wt.create('run3');
  writeFileSync(join(w.path, 'a.txt'), 'one\nTWO from agent\nthree\n');
  await wt.finish('run3');
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo edited by user\nthree\n'); // uncommitted
  await assert.rejects(wt.merge('run3'), (e) => e instanceof MergeError && e.code === 'dirty');
  sh(dir, 'commit', '-q', '-am', 'user edit'); // now it conflicts
  await assert.rejects(wt.merge('run3'), (e) => e.code === 'conflict' && e.files.includes('a.txt'));
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8').includes('<<<<'), false); // the user's file is never left half merged
});
