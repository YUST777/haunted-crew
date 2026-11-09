import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createBackup } from '../src/backup.mjs';

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'backup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function put(root, rel, content) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function seed(root) {
  put(root, '.haunted-crew/workflows.json', JSON.stringify({ flows: [{ id: 1 }] }));
  put(root, '.haunted-crew/memory.json', '{"ghost":[]}');
  put(root, '.haunted-crew/mailbox.json', '[]');
  put(root, '.haunted-crew/channels.json', '{}');
  put(root, '.haunted-crew/history.jsonl', '{"a":1}\n{"b":2}\n');
  put(root, '.kiro/skills/hello/SKILL.md', '---\nname: hello\ndescription: hi\n---\nSay hi.');
  put(root, '.kiro/other/notes.txt', 'not exported');
}

test('export includes state files and skill SKILL.md files only', (t) => {
  const root = setup(t);
  seed(root);
  const b = createBackup({ root }).export();
  assert.equal(b.version, 1);
  assert.equal(typeof b.createdAt, 'string');
  assert.equal(JSON.parse(b.files['.haunted-crew/workflows.json']).flows[0].id, 1);
  assert.ok(b.files['.haunted-crew/memory.json']);
  assert.ok(b.files['.haunted-crew/history.jsonl']);
  assert.ok(b.files['.kiro/skills/hello/SKILL.md'].includes('Say hi.'));
  assert.equal(b.files['.kiro/other/notes.txt'], undefined);
});

test('export strips secrets from routines and nested token keys', (t) => {
  const root = setup(t);
  put(root, '.haunted-crew/routines.json', JSON.stringify({
    routines: [{ id: 'r1', secret: 'shh', cron: '* * * * *', hook: { url: 'x', secret: 'deep' } }],
    secret: 42,
  }));
  put(root, '.haunted-crew/config.json', JSON.stringify({ auth: { token: 'abc', user: 'me' }, apiKey: 'k', password: 'p', name: 'n' }));
  put(root, '.haunted-crew/tokens.json', '{"access":"zzz"}');
  const b = createBackup({ root }).export();
  const routines = JSON.parse(b.files['.haunted-crew/routines.json']);
  assert.equal(routines.routines[0].secret, null);
  assert.equal(routines.routines[0].hook.secret, null);
  assert.equal(routines.routines[0].cron, '* * * * *');
  assert.equal(routines.secret, null);
  const cfg = JSON.parse(b.files['.haunted-crew/config.json']);
  assert.equal(cfg.auth.token, null);
  assert.equal(cfg.auth.user, 'me');
  assert.equal(cfg.apiKey, null);
  assert.equal(cfg.password, null);
  assert.equal(cfg.name, 'n');
  assert.equal(b.files['.haunted-crew/tokens.json'], undefined);
  assert.equal(JSON.stringify(b).includes('shh'), false);
});

test('export drops unparseable json and redacts history lines', (t) => {
  const root = setup(t);
  put(root, '.haunted-crew/broken.json', '{"secret": "oops"');
  put(root, '.haunted-crew/history.jsonl', '{"token":"t1","ok":true}\nnot json\n');
  const b = createBackup({ root }).export();
  assert.equal(b.files['.haunted-crew/broken.json'], undefined);
  assert.deepEqual(b.files['.haunted-crew/history.jsonl'], '{"token":null,"ok":true}\n');
});

test('binary agent-data.db roundtrips through base64', (t) => {
  const src = setup(t);
  const bytes = Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x00, 0xff, 0x10, 0x00]);
  put(src, '.haunted-crew/agent-data.db', bytes);
  const b = createBackup({ root: src }).export();
  assert.equal(b.files['.haunted-crew/agent-data.db'], undefined);
  assert.equal(Buffer.from(b.binary['.haunted-crew/agent-data.db'], 'base64').equals(bytes), true);

  const dst = setup(t);
  createBackup({ root: dst }).import(b);
  assert.equal(readFileSync(join(dst, '.haunted-crew/agent-data.db')).equals(bytes), true);
});

test('import skips existing files unless overwrite is set', (t) => {
  const root = setup(t);
  put(root, '.haunted-crew/memory.json', 'local');
  const bundle = { version: 1, files: { '.haunted-crew/memory.json': 'remote', '.haunted-crew/mailbox.json': '[1]' }, binary: {} };
  const backup = createBackup({ root });
  const r = backup.import(bundle);
  assert.deepEqual(r.written, ['.haunted-crew/mailbox.json']);
  assert.deepEqual(r.skipped, ['.haunted-crew/memory.json']);
  assert.equal(readFileSync(join(root, '.haunted-crew/memory.json'), 'utf8'), 'local');

  const r2 = backup.import(bundle, { overwrite: true });
  assert.deepEqual(r2.written.sort(), ['.haunted-crew/mailbox.json', '.haunted-crew/memory.json']);
  assert.equal(readFileSync(join(root, '.haunted-crew/memory.json'), 'utf8'), 'remote');
  assert.equal(readdirSync(join(root, '.haunted-crew')).some((f) => f.endsWith('.tmp')), false);
});

test('import rejects traversal, absolute and out-of-scope paths and writes nothing', (t) => {
  const root = setup(t);
  const evil = join(dirname(root), `evil-${process.pid}.txt`);
  const bad = [
    '../evil',
    '.haunted-crew/../../evil',
    '/etc/evil',
    'C:/evil',
    '.haunted-crew/a/../../../evil',
    'src/index.mjs',
    '.kiro/skills/x/notes.md',
    '.haunted-crew//x',
  ];
  for (const p of bad) {
    const bundle = { version: 1, files: { '.haunted-crew/ok.json': '{}', [p]: 'x' }, binary: {} };
    assert.throws(() => createBackup({ root }).import(bundle), Error, p);
  }
  assert.equal(existsSync(join(root, '.haunted-crew/ok.json')), false);
  assert.equal(existsSync(evil), false);
  assert.throws(() => createBackup({ root }).import({ version: 2, files: {} }), TypeError);
});

test('export throws when over the 20 MB size limit', (t) => {
  const root = setup(t);
  put(root, '.haunted-crew/big.bin', Buffer.alloc(20 * 1024 * 1024 + 1, 1));
  assert.throws(() => createBackup({ root }).export(), /20 MB/);
});

test('import rejects an oversized bundle', (t) => {
  const root = setup(t);
  const bundle = { version: 1, files: { '.haunted-crew/a.txt': 'x'.repeat(20 * 1024 * 1024 + 1) }, binary: {} };
  assert.throws(() => createBackup({ root }).import(bundle), /20 MB/);
});
