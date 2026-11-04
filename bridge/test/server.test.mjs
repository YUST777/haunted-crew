import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createBridge } from '../src/server.mjs';

const tokens = { ingest: 'i'.repeat(43), view: 'v'.repeat(43) };
const quiet = { error() {}, warn() {}, log() {} };
let bridge, base;

before(async () => {
  bridge = createBridge({ tokens, log: quiet });
  const { port } = await bridge.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});
after(() => bridge.close());

const post = (body, token = tokens.ingest, headers = {}) =>
  fetch(`${base}/event`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

function openStream(query = '', headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/stream${query}`, { headers });
    const messages = [];
    ws.on('message', (d) => messages.push(JSON.parse(d)));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)));
    ws.on('error', reject);
  });
}

const waitFor = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
};

test('healthz is public', async () => {
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
});

test('posting requires the ingest token', async () => {
  assert.equal((await post({ hook_event_name: 'Stop' }, 'wrong')).status, 401);
  assert.equal((await post({ hook_event_name: 'Stop' }, tokens.view)).status, 403);
  assert.equal((await post({ hook_event_name: 'Stop' })).status, 202);
});

test('bad input is rejected', async () => {
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post({ hook_event_name: 'Nope' })).status, 400);
  assert.equal((await post('x'.repeat(1024 * 1024 + 10))).status, 413);
});

test('stream rejects missing token, accepts view token via query and header', async () => {
  await assert.rejects(openStream(), /401/);
  const a = await openStream(`?token=${tokens.view}`);
  const b = await openStream('', { authorization: `Bearer ${tokens.view}` });
  await waitFor(() => a.messages.length && b.messages.length);
  assert.equal(a.messages[0].type, 'hello');
  assert.equal(a.messages[0].role, 'view');
  a.ws.close();
  b.ws.close();
});

test('events are broadcast with derived ghost status', async () => {
  const { ws, messages } = await openStream(`?token=${tokens.view}`);
  await post({ session_id: 'g1', tool_name: 'execute_bash' }, tokens.ingest, { 'x-kiro-trigger': 'PreToolUse' });
  await post({ session_id: 'g1', tool_name: 'execute_bash', tool_response: { exit_code: 1 } }, tokens.ingest, {
    'x-kiro-trigger': 'PostToolUse',
  });
  await post({ session_id: 'g1' }, tokens.ingest, { 'x-kiro-trigger': 'Stop' });
  await waitFor(() => messages.filter((m) => m.type === 'event').length === 3);
  const statuses = messages.filter((m) => m.type === 'event').map((m) => m.session.status);
  assert.deepEqual(statuses, ['working', 'error', 'waiting']);
  assert.equal(messages[1].event.category, 'shell');
  ws.close();

  const state = await (await fetch(`${base}/state`, { headers: { authorization: `Bearer ${tokens.view}` } })).json();
  assert.equal(state.sessions.find((s) => s.session === 'g1').status, 'waiting');
});

test('send-event exits 0 and prints nothing, even when the bridge is down', async () => {
  const sender = fileURLToPath(new URL('../bin/send-event.mjs', import.meta.url));
  const run = (url) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [sender, 'Stop'], {
        env: { ...process.env, HAUNTED_CREW_URL: url, HAUNTED_CREW_INGEST_TOKEN: tokens.ingest },
      });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', (code) => resolve({ code, out }));
      p.stdin.end(JSON.stringify({ session_id: 'sender' }));
    });

  const ok = await run(base);
  assert.deepEqual(ok, { code: 0, out: '' });
  const down = await run('http://127.0.0.1:1');
  assert.deepEqual(down, { code: 0, out: '' });
});

test('dashboard page is served without the token in it', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await r.text();
  assert.ok(html.includes('Haunted Crew'));
  assert.ok(!html.includes(tokens.view));
});

test('browser controls need the command token', async () => {
  const r = await fetch(`${base}/browser/open`, { method: 'POST', headers: { authorization: `Bearer ${tokens.view}` }, body: '{"url":"https://example.com"}' });
  assert.equal(r.status, 403);
  assert.equal((await fetch(`${base}/browser/status`)).status, 401);
});
