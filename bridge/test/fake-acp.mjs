// Stand-in for `kiro-cli acp` in tests: speaks just enough ACP (JSON lines over stdio).
import { createInterface } from 'node:readline';

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
let sessions = 0;
const waiting = new Map(); // our request id -> resolve

createInterface({ input: process.stdin }).on('line', async (line) => {
  const msg = JSON.parse(line);
  if (msg.id !== undefined && !msg.method) {
    waiting.get(msg.id)?.(msg.result);
    return;
  }
  if (msg.method === 'initialize') return send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  if (msg.method === 'session/new') {
    const availableModels = [{ modelId: 'claude-haiku-5.5', name: 'claude-haiku-5.5' }, { modelId: 'claude-sonnet-5.5', name: 'claude-sonnet-5.5' }];
    return send({ id: msg.id, result: { sessionId: `fake-${process.pid}-${++sessions}`, models: { currentModelId: 'claude-sonnet-5.5', availableModels } } });
  }
  if (msg.method === 'session/set_model') return send({ id: msg.id, result: {} });
  if (msg.method === 'session/prompt') {
    const sessionId = msg.params.sessionId;
    const update = (u) => send({ method: 'session/update', params: { sessionId, update: u } });
    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'The bug is in app.ts.' } });
    update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Edit app.ts', kind: 'edit', status: 'pending', locations: [{ path: process.cwd() + '/src/app.ts' }] });
    const answer = await new Promise((resolve) => {
      waiting.set(900, resolve);
      send({ id: 900, method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 't1', title: 'Edit app.ts' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }] } });
    });
    const allowed = answer?.outcome?.optionId === 'allow';
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: allowed ? 'completed' : 'failed' });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: allowed ? 'Done, ' : 'Skipped, ' } });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'see app.ts.' } });
    return send({ id: msg.id, result: { stopReason: 'end_turn' } });
  }
});
