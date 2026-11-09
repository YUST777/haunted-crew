// Stand-in for `kiro-cli acp` that records the MCP servers it was given, so a test can start them.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
let n = 0;
createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') return send({ id: msg.id, result: { protocolVersion: 1 } });
  if (msg.method === 'session/new') {
    appendFileSync(process.env.FAKE_OUT, JSON.stringify(msg.params.mcpServers) + '\n'); // one line per session; the first is the named agent's
    return send({ id: msg.id, result: { sessionId: `m-${process.pid}-${++n}`, models: { currentModelId: 'claude-haiku-5.5', availableModels: [{ modelId: 'claude-haiku-5.5', name: 'h' }] } } });
  }
  if (msg.method === 'session/set_model') return send({ id: msg.id, result: {} });
  if (msg.method === 'session/prompt') {
    const { sessionId, prompt } = msg.params;
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `echo: ${prompt[0].text.slice(0, 60)}` } } } });
    send({ id: msg.id, result: { stopReason: 'end_turn' } });
  }
});
