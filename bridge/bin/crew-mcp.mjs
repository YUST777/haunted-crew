#!/usr/bin/env node
// Stdio MCP server that gives a Kiro agent the crew's tools. Started by kiro-cli (the bridge lists it
// in session/new). It only forwards: tools/list and tools/call go to the bridge over HTTP with the
// per-session token in HC_TOKEN. Env: HC_BRIDGE_URL, HC_TOKEN.
import { createInterface } from 'node:readline';

const base = process.env.HC_BRIDGE_URL;
const token = process.env.HC_TOKEN;
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

async function api(path, body) {
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6 * 60_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `bridge answered ${res.status}`);
  return json;
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return; // notifications (initialized, cancelled): nothing to do
  try {
    if (msg.method === 'initialize') {
      return send({ id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'crew', version: '1' } } });
    }
    if (msg.method === 'tools/list') return send({ id: msg.id, result: { tools: (await api('/tools')).tools } });
    if (msg.method === 'tools/call') {
      try {
        const out = await api('/tools/call', { tool: msg.params?.name, args: msg.params?.arguments ?? {} });
        return send({ id: msg.id, result: { content: [{ type: 'text', text: out.text }] } });
      } catch (err) {
        return send({ id: msg.id, result: { isError: true, content: [{ type: 'text', text: err.message }] } });
      }
    }
    if (msg.method === 'ping') return send({ id: msg.id, result: {} });
    send({ id: msg.id, error: { code: -32601, message: `unsupported: ${msg.method}` } });
  } catch (err) {
    send({ id: msg.id, error: { code: -32603, message: err.message } });
  }
});
