#!/usr/bin/env node
// Demo stand-in for `kiro-cli acp`: speaks ACP over stdio and pretends to work, so the console and
// ghosts can be shown without a Kiro account. Use: HAUNTED_CREW_KIRO_CLI=/path/to/demo-agent.mjs
import { createInterface } from 'node:readline';

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waiting = new Map();
let nextId = 1000;
let sessions = 0;

function ask(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    send({ id, method, params });
  });
}

async function work(id, sessionId, text) {
  const update = (u) => send({ method: 'session/update', params: { sessionId, update: u } });
  const tool = async (n, title, kind, path, ms) => {
    update({ sessionUpdate: 'tool_call', toolCallId: `t${n}`, title, kind, status: 'in_progress', locations: path ? [{ path: `${process.cwd()}/${path}` }] : [] });
    await sleep(ms);
    update({ sessionUpdate: 'tool_call_update', toolCallId: `t${n}`, status: 'completed' });
  };
  for (const w of `The user asked: "${String(text).slice(0, 60)}". I should read the README first, then find where login is handled before changing anything.`.split(' ')) {
    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: w + ' ' } });
    await sleep(60);
  }
  await tool(1, 'Read README.md', 'read', 'README.md', 1500);
  await tool(2, 'Search for "login"', 'search', null, 1500);
  update({ sessionUpdate: 'tool_call', toolCallId: 't3', title: 'Edit src/app.ts', kind: 'edit', status: 'pending', locations: [{ path: `${process.cwd()}/src/app.ts` }] });
  const answer = await ask('session/request_permission', {
    sessionId,
    toolCall: { toolCallId: 't3', title: 'Edit src/app.ts' },
    options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
  });
  const allowed = answer?.outcome?.optionId === 'allow';
  await sleep(1200);
  update({ sessionUpdate: 'tool_call_update', toolCallId: 't3', status: allowed ? 'completed' : 'failed' });
  if (allowed) await tool(4, 'Run npm test', 'execute', null, 2500);
  const reply = allowed
    ? `Done: "${text.slice(0, 60)}". I edited src/app.ts and the tests pass.`
    : 'You rejected the edit, so I left src/app.ts alone.';
  for (const w of reply.split(/(?<= )/)) {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: w } });
    await sleep(70);
  }
  send({ id, result: { stopReason: 'end_turn' } });
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id !== undefined && !msg.method) return waiting.get(msg.id)?.(msg.result);
  if (msg.method === 'initialize') return send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  if (msg.method === 'session/new') {
    const availableModels = ['claude-haiku-5.5', 'claude-sonnet-5.5', 'claude-opus-5.5', 'qwen3-coder-next', 'auto'].map((m) => ({ modelId: m, name: m }));
    return send({ id: msg.id, result: { sessionId: `demo-${process.pid}-${++sessions}`, models: { currentModelId: 'claude-haiku-5.5', availableModels } } });
  }
  if (msg.method === 'session/set_model') return send({ id: msg.id, result: {} });
  if (msg.method === 'session/prompt') {
    const text = msg.params?.prompt?.map((p) => p.text ?? '').join(' ') ?? '';
    work(msg.id, msg.params.sessionId, text);
  }
});
