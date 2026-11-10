// Scripted `kiro-cli acp` stand-in for a lead + teammates: the lead assigns Coder, then Reviewer, then finishes.
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
let n = 0;
const turns = new Map(); // sessionId -> prompts seen
const cwds = new Map(); // sessionId -> folder it was started in
createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') return send({ id: msg.id, result: { protocolVersion: 1 } });
  if (msg.method === 'session/new') { cwds.set(`t-${process.pid}-${n + 1}`, msg.params.cwd); return send({ id: msg.id, result: { sessionId: `t-${process.pid}-${++n}`, models: { currentModelId: 'claude-haiku-5.5', availableModels: [{ modelId: 'claude-haiku-5.5', name: 'h' }] } } }); }
  if (msg.method === 'session/set_model') return send({ id: msg.id, result: {} });
  if (msg.method !== 'session/prompt') return;
  const { sessionId, prompt } = msg.params;
  const text = prompt[0].text;
  const k = (turns.get(sessionId) ?? 0) + 1;
  turns.set(sessionId, k);
  let reply;
  if (/You are the LEAD/.test(text)) {
    reply = 'Plan: code first.\n```json\n{"assign":[{"to":"Coder","task":"write hello.txt"}]}\n```';
  } else if (/Results from your teammates/.test(text) && /## Coder/.test(text) && !/## Reviewer/.test(text)) {
    reply = 'Now review.\n```json\n{"assign":[{"to":"Reviewer","task":"review hello.txt"}]}\n```';
  } else if (/Results from your teammates/.test(text)) {
    reply = '```json\n{"done":"shipped: coded and reviewed"}\n```';
  } else if (/"Coder", a teammate/.test(text) && k === 1) {
    reply = 'Need review help.\n```json\n{"ask":[{"to":"Reviewer","text":"is hello ok?"}]}\n```';
  } else if (/Message from teammate/.test(text)) {
    reply = 'Status: done\nResult: looks fine\nEvidence: none';
  } else {
    reply = 'Status: done\nResult: finished\nEvidence: hello.txt';
    if (cwds.get(sessionId)) writeFileSync(join(cwds.get(sessionId), 'hello.txt'), 'hi\n'); // the Coder writes its file where it works
  }
  send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply } } } });
  send({ id: msg.id, result: { stopReason: 'end_turn' } });
});
