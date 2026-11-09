import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSkillStore } from '../src/skillstore.mjs';

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'skillstore-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, store: createSkillStore({ root }) };
}

test('create writes SKILL.md with frontmatter under a slugged dir', (t) => {
  const { root, store } = setup(t);
  const r = store.create({ name: 'Code Review', description: 'Reviews diffs', instructions: 'Read the diff.' });
  assert.deepEqual(r, { slug: 'code-review', name: 'Code Review' });
  const text = readFileSync(join(root, '.kiro', 'skills', 'code-review', 'SKILL.md'), 'utf8');
  assert.equal(text, '---\nname: Code Review\ndescription: Reviews diffs\n---\nRead the diff.');
});

test('create slugs odd names and rejects names with no slug characters', (t) => {
  const { store } = setup(t);
  assert.equal(store.create({ name: '  My Cool  Skill!!  ', instructions: 'x' }).slug, 'my-cool-skill');
  assert.throws(() => store.create({ name: '!!!', instructions: 'x' }), RangeError);
  assert.throws(() => store.create({ name: 'a'.repeat(41), instructions: 'x' }), RangeError);
});

test('create rejects duplicates', (t) => {
  const { store } = setup(t);
  store.create({ name: 'dup', instructions: 'one' });
  assert.throws(() => store.create({ name: 'DUP', instructions: 'two' }), /already exists/);
  assert.equal(store.read('dup').endsWith('one'), true);
});

test('create validates field sizes and rejects newlines in one-line fields', (t) => {
  const { store } = setup(t);
  assert.throws(() => store.create({ name: '', instructions: 'x' }), RangeError);
  assert.throws(() => store.create({ name: 'n'.repeat(61), instructions: 'x' }), RangeError);
  assert.throws(() => store.create({ name: 'ok', description: 'd'.repeat(201), instructions: 'x' }), RangeError);
  assert.throws(() => store.create({ name: 'ok', instructions: '' }), RangeError);
  assert.throws(() => store.create({ name: 'ok', instructions: 'i'.repeat(12001) }), RangeError);
  assert.throws(() => store.create({ name: 'ok\nevil: yes', instructions: 'x' }), RangeError);
  assert.throws(() => store.create({ name: 'ok', description: 'a\nb', instructions: 'x' }), RangeError);
  assert.throws(() => store.create({ name: 42, instructions: 'x' }), TypeError);
});

test('revise rewrites description and instructions, keeps name', (t) => {
  const { store } = setup(t);
  store.create({ name: 'Keep Me', description: 'old', instructions: 'old text' });
  store.revise('keep-me', { description: 'new', instructions: 'new text' });
  assert.equal(store.read('keep-me'), '---\nname: Keep Me\ndescription: new\n---\nnew text');
  assert.throws(() => store.revise('missing', { description: 'd', instructions: 'i' }), /no such skill/);
});

test('list returns slug, name, description and caps at 50', (t) => {
  const { store } = setup(t);
  assert.deepEqual(store.list(), []);
  store.create({ name: 'alpha', description: 'first', instructions: 'a' });
  assert.deepEqual(store.list(), [{ slug: 'alpha', name: 'alpha', description: 'first' }]);
  for (let i = 0; i < 55; i++) store.create({ name: `skill ${String(i).padStart(2, '0')}`, instructions: 'x' });
  assert.equal(store.list().length, 50);
});

test('read returns full text and remove deletes the skill', (t) => {
  const { root, store } = setup(t);
  store.create({ name: 'gone', description: 'bye', instructions: 'soon' });
  assert.match(store.read('gone'), /^---\nname: gone\n/);
  store.remove('gone');
  assert.equal(existsSync(join(root, '.kiro', 'skills', 'gone')), false);
  assert.throws(() => store.read('gone'), /no such skill/);
  assert.throws(() => store.remove('gone'), /no such skill/);
});

test('path traversal in slug is rejected', (t) => {
  const { root, store } = setup(t);
  for (const bad of ['../evil', '..', 'a/b', '/etc/passwd', '', 'UPPER', '-lead']) {
    assert.throws(() => store.read(bad), RangeError, bad);
    assert.throws(() => store.remove(bad), RangeError, bad);
    assert.throws(() => store.revise(bad, { description: 'd', instructions: 'i' }), RangeError, bad);
  }
  assert.equal(existsSync(join(root, '.kiro', 'evil')), false);
});

test('install copies a local SKILL.md into the store', (t) => {
  const { root, store } = setup(t);
  const src = join(mkdtempSync(join(tmpdir(), 'skillsrc-')), 'SKILL.md');
  t.after(() => rmSync(join(src, '..'), { recursive: true, force: true }));
  writeFileSync(src, '---\nname: Imported One\ndescription: from file\n---\nDo the thing.');
  assert.deepEqual(store.install(src), { slug: 'imported-one', name: 'Imported One' });
  assert.equal(readFileSync(join(root, '.kiro', 'skills', 'imported-one', 'SKILL.md'), 'utf8'), readFileSync(src, 'utf8'));
  assert.throws(() => store.install(src), /already exists/);
});

test('install requires frontmatter with a name, a regular file, and 64KB max', (t) => {
  const { store } = setup(t);
  const dir = mkdtempSync(join(tmpdir(), 'skillsrc-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const noFront = join(dir, 'a.md');
  writeFileSync(noFront, 'just instructions');
  assert.throws(() => store.install(noFront), /frontmatter/);
  const noName = join(dir, 'b.md');
  writeFileSync(noName, '---\ndescription: x\n---\nbody');
  assert.throws(() => store.install(noName), /frontmatter/);
  const big = join(dir, 'big.md');
  writeFileSync(big, `---\nname: big\n---\n${'x'.repeat(64 * 1024)}`);
  assert.throws(() => store.install(big), RangeError);
  assert.throws(() => store.install(dir), /regular file/);
});
