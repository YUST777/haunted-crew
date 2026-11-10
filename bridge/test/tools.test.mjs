import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTools, TOOL_SCHEMAS } from '../src/tools.mjs';
import { createMailbox } from '../src/mailbox.mjs';
import { createMemory } from '../src/memory.mjs';
import { createSharedData } from '../src/shared-data.mjs';
import { createHistory } from '../src/history.mjs';
import { createBridge } from '../src/server.mjs';

const deps = (agents) => ({ agents, mailbox: createMailbox(), memory: createMemory(), sharedData: createSharedData(), history: createHistory() });

test('send_message waits for the reply, refuses unknown, self and deadlocks', async () => {
  const gate = {};
  const agents = {
    list: () => [{ name: 'Ann', session: 'sa', busy: true }, { name: 'Bob', session: 'sb', busy: false }],
    run: (session, text) => new Promise((res) => { gate[session] = () => res(`${session} saw: ${text.split('\n')[0]}`); }),
  };
  const t = createTools(deps(agents));
  const ann = { name: 'Ann', session: 'sa' }, bob = { name: 'Bob', session: 'sb' };
  await assert.rejects(t.call(ann, 'send_message', { to: 'nobody', text: 'x' }), /no working agent/);
  await assert.rejects(t.call(ann, 'send_message', { to: 'ann', text: 'x' }), /itself/);
  const pending = t.call(ann, 'send_message', { to: 'Bob', text: 'audit auth.ts' });
  await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(t.call(bob, 'send_message', { to: 'Ann', text: 'back' }), /waiting for you/); // Ann waits on Bob
  gate.sb();
  assert.match(await pending, /Reply from Bob.*sb saw: Message from teammate Ann\./s);
});

test('data tools use the caller as owner; memory is per caller', async () => {
  const t = createTools(deps({ list: () => [] }));
  const a = { name: 'A', session: '1' }, b = { name: 'B', session: '2' };
  await t.call(a, 'execute_data', { sql: 'CREATE TABLE leads(email TEXT)' });
  await assert.rejects(t.call(b, 'delete_table', { name: 'leads' }), /owned by A/);
  assert.match(await t.call(a, 'list_tables'), /"owner":"A"/);
  await t.call(a, 'remember', { text: 'the db is shared', tags: ['db'] });
  assert.match(await t.call(a, 'search_memories', { query: 'db' }), /shared/);
  assert.equal(await t.call(b, 'search_memories', { query: 'db' }), '[]');
  await assert.rejects(t.call(a, 'nope'), /unknown tool/);
  assert.ok(TOOL_SCHEMAS.every((s) => s.inputSchema.type === 'object'));
});

test('bridge hands each agent a crew MCP server that works end to end', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'hc-mcp-')), 'mcp.json');
  process.env.FAKE_OUT = out;
  const tokens = { ingest: 'i'.repeat(43), command: 'c'.repeat(43), view: 'v'.repeat(43) };
  const quiet = { error() {}, warn() {}, log() {} };
  const fake = fileURLToPath(new URL('./fake-mcp-acp.mjs', import.meta.url));
  const bridge = createBridge({ tokens, log: quiet, agentOptions: { command: process.execPath, args: [fake], cwd: mkdtempSync(join(tmpdir(), 'hc-mcp-')), processes: 1 } });
  const { port } = await bridge.listen(0, '127.0.0.1');
  try {
    const created = await (await fetch(`http://127.0.0.1:${port}/agents`, { method: 'POST', headers: { authorization: `Bearer ${tokens.command}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Scout' }) })).json();
    assert.ok(created.session);
    const [server] = JSON.parse(readFileSync(out, 'utf8').split('\n')[0]);
    assert.equal(server.name, 'crew');
    const child = spawn(server.command, server.args, { env: { ...process.env, ...Object.fromEntries(server.env.map((e) => [e.name, e.value])) } });
    const waiters = [];
    createInterface({ input: child.stdout }).on('line', (l) => waiters.shift()?.(JSON.parse(l)));
    const ask = (id, method, params) => new Promise((resolve) => {
      waiters.push(resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    const init = await ask(1, 'initialize', { protocolVersion: '2024-11-05' });
    assert.equal(init.result.serverInfo.name, 'crew');
    const list = await ask(2, 'tools/list');
    assert.ok(list.result, JSON.stringify(list));
    assert.ok(list.result.tools.some((t) => t.name === 'send_message'));
    const call = await ask(3, 'tools/call', { name: 'list_agents', arguments: {} });
    assert.match(call.result.content[0].text, /Scout/);
    const bad = await ask(4, 'tools/call', { name: 'nope', arguments: {} });
    assert.equal(bad.result.isError, true);
    child.kill();
    const noauth = await fetch(`http://127.0.0.1:${port}/tools`, { headers: { authorization: 'Bearer wrong' } });
    assert.equal(noauth.status, 401);
  } finally {
    await bridge.close();
  }
});

test('unread no-reply notes ride along on the next tool result (mid-turn steering)', async () => {
  const d = deps({ list: () => [] });
  const t = createTools(d);
  const a = { name: 'A', session: '1' };
  d.mailbox.send({ from: 'Lead', to: ['A'], text: 'use tabs', expectsReply: false });
  d.mailbox.send({ from: 'Lead', to: ['A'], text: 'answer me', expectsReply: true });
  const first = await t.call(a, 'list_tables');
  assert.match(first, /\[NEW MESSAGES\]\n- from Lead: use tabs/);
  assert.doesNotMatch(first, /answer me/); // expects a reply: delivered as a prompt instead
  assert.doesNotMatch(await t.call(a, 'list_tables'), /NEW MESSAGES/); // delivered once
});
