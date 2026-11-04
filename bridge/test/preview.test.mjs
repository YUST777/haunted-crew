import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../src/server.mjs';

const tokens = { ingest: 'i'.repeat(43), command: 'c'.repeat(43), view: 'v'.repeat(43) };
let bridge, base;
const root = mkdtempSync(join(tmpdir(), 'hc-preview-'));

before(async () => {
  mkdirSync(join(root, 'css'));
  writeFileSync(join(root, 'index.html'), '<h1>Cookies</h1>');
  writeFileSync(join(root, 'css', 'site.css'), 'h1{}');
  writeFileSync(join(tmpdir(), 'hc-secret.txt'), 'nope');
  bridge = createBridge({ tokens, log: { warn() {}, error() {} }, previewRoot: root });
  base = `http://127.0.0.1:${(await bridge.listen(0, '127.0.0.1')).port}`;
});
after(() => bridge.close());

test('preview needs a token, then a cookie carries it', async () => {
  assert.equal((await fetch(`${base}/preview/`)).status, 401);
  const r = await fetch(`${base}/preview/?token=${tokens.view}`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<h1>Cookies</h1>');
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  const css = await fetch(`${base}/preview/css/site.css`, { headers: { cookie } });
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('content-type'), 'text/css');
});

test('preview cannot escape the project folder', async () => {
  const r = await fetch(`${base}/preview/..%2fhc-secret.txt?token=${tokens.view}`);
  assert.ok([403, 404].includes(r.status));
  assert.notEqual(await r.text(), 'nope');
});
