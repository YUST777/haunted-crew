import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { tmpdir } from 'node:os';
import { createBridge } from '../src/server.mjs';

const tokens = { ingest: 'i'.repeat(43), command: 'c'.repeat(43), view: 'v'.repeat(43) };
const quiet = { error() {}, warn() {}, log() {} };
const fake = fileURLToPath(new URL('./fake-acp.mjs', import.meta.url));
let bridge, base, events, stream;

before(async () => {
  bridge = createBridge({ tokens, log: quiet, agentOptions: { command: process.execPath, args: [fake], cwd: tmpdir() } });
  const { port } = await bridge.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  events = [];
  await new Promise((resolve, reject) => {
    const ws = (stream = new WebSocket(`${base.replace('http', 'ws')}/stream?token=${tokens.view}`));
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.type === 'event') events.push(m);
    });
    ws.on('open', resolve);
    ws.on('error', reject);
  });
});
after(() => {
  stream.close();
  return bridge.close();
});

const call = (path, body, token = tokens.command, method = 'POST') =>
  fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const waitFor = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout; saw ' + JSON.stringify(events.map((m) => [m.event.session, m.event.kind])));
};

test('only the command token may start or prompt agents', async () => {
  assert.equal((await call('/agents', { name: 'Coder' }, tokens.view)).status, 403);
  assert.equal((await call('/agents', { name: 'Coder' }, tokens.ingest)).status, 403);
  assert.equal((await call('/agents', { name: 'Coder' }, 'nope')).status, 401);
  assert.equal((await call('/agents', undefined, tokens.view, 'GET')).status, 200);
});

test('validates input', async () => {
  assert.equal((await call('/agents', { name: '<script>' })).status, 400);
  assert.equal((await call('/agents/unknown/prompt', { text: 'hi' })).status, 404);
});

test('full loop: create, prompt, permission, reply', async () => {
  assert.equal((await call('/agents', { name: 'Coder', model: 'gpt-nope' })).status, 400);
  const created = await call('/agents', { name: 'Coder' });
  assert.equal(created.status, 201);
  const { session, model } = await created.json();
  assert.equal(model, 'claude-haiku-5.5');

  assert.equal((await call(`/agents/${session}/prompt`, { text: '' })).status, 400);
  assert.equal((await call(`/agents/${session}/prompt`, { text: 'fix the login bug' })).status, 202);

  const perm = await waitFor(() => events.find((m) => m.event.session === session && m.event.kind === 'permission'));
  assert.equal(perm.session.status, 'waiting');
  assert.equal(perm.event.request.title, 'Edit app.ts');
  assert.equal((await call(`/agents/${session}/permission`, { requestId: perm.event.request.id, optionId: 'bogus' })).status, 400);
  assert.equal((await call(`/agents/${session}/permission`, { requestId: perm.event.request.id, optionId: 'allow' })).status, 200);

  const stop = await waitFor(() => events.find((m) => m.event.session === session && m.event.kind === 'stop'));
  const kinds = events.filter((m) => m.event.session === session).map((m) => m.event.kind);
  assert.deepEqual(kinds, ['session_start', 'prompt', 'thought', 'tool_start', 'permission', 'permission_resolved', 'tool_end', 'message', 'stop']);
  const toolStart = events.find((m) => m.event.session === session && m.event.kind === 'tool_start').event;
  assert.equal(toolStart.category, 'write');
  assert.equal(toolStart.file, 'src/app.ts');
  assert.equal(events.find((m) => m.event.kind === 'message').event.text, 'Done, see app.ts.');
  assert.equal(stop.session.agent, 'Coder');
  assert.equal(stop.session.console, true);

  const list = await (await call('/agents', undefined, tokens.view, 'GET')).json();
  assert.equal(list.agents[0].name, 'Coder');
  assert.equal(list.agents[0].model, 'claude-haiku-5.5');
  assert.equal(events.find((m) => m.event.kind === 'thought').event.text, 'The bug is in app.ts.');
  assert.equal(stop.session.model, 'claude-haiku-5.5');
});

test('runner disabled without a workspace', async () => {
  const b = createBridge({ tokens, log: quiet });
  const { port } = await b.listen(0, '127.0.0.1');
  const r = await fetch(`http://127.0.0.1:${port}/agents`, {
    method: 'POST', headers: { authorization: `Bearer ${tokens.command}` }, body: '{"name":"x"}',
  });
  assert.equal(r.status, 503);
  await b.close();
});

test('pairing code buys tokens once', async () => {
  const { code } = bridge.pairingCode();
  const pair = (c) => fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ code: c }) });
  assert.equal((await pair('HC-AAAA-BBBB')).status, 401);
  const ok = await pair(code.toLowerCase().replaceAll('-', ''));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { view: tokens.view, command: tokens.command });
  assert.equal((await pair(code)).status, 401, 'single use');
});

test('kiro status needs a token; demo mode reports signed in', async () => {
  assert.equal((await fetch(`${base}/kiro/status`)).status, 401);
  const b = createBridge({ tokens, log: quiet, kiroOptions: { demo: true } });
  const { port } = await b.listen(0, '127.0.0.1');
  const r = await fetch(`http://127.0.0.1:${port}/kiro/status`, { headers: { authorization: `Bearer ${tokens.view}` } });
  assert.deepEqual(await r.json(), { signedIn: true, user: 'demo mode', demo: true });
  const login = await fetch(`http://127.0.0.1:${port}/kiro/login`, { method: 'POST', headers: { authorization: `Bearer ${tokens.view}` } });
  assert.equal(login.status, 403);
  await b.close();
});

test('rejecting is reported as rejected', async () => {
  const { session } = await (await call('/agents', { name: 'Tester' })).json();
  await call(`/agents/${session}/prompt`, { text: 'try it' });
  const perm = await waitFor(() => events.find((m) => m.event.session === session && m.event.kind === 'permission'));
  await call(`/agents/${session}/permission`, { requestId: perm.event.request.id, optionId: 'reject' });
  const resolved = await waitFor(() => events.find((m) => m.event.session === session && m.event.kind === 'permission_resolved'));
  assert.equal(resolved.event.text, 'rejected');
  const failed = await waitFor(() => events.find((m) => m.event.session === session && m.event.kind === 'tool_end'));
  assert.equal(failed.event.ok, false);
  assert.equal(failed.event.tool, 'Edit app.ts');
});
