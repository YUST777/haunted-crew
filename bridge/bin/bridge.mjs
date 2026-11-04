#!/usr/bin/env node
import { agentConfig, loadOrCreateTokens, serverConfig, tokensPath } from '../src/config.mjs';
import { createBridge } from '../src/server.mjs';

const tokens = loadOrCreateTokens();
const { host, port } = serverConfig();
const agentOptions = agentConfig();
const bridge = createBridge({ tokens, agentOptions });

const addr = await bridge.listen(port, host);
console.log(`[bridge] listening on http://${addr.address}:${addr.port}`);
console.log(`[bridge] tokens: ${tokensPath()} (ingest = Kiro hooks, command = console agents, view = mod/dashboard)`);
console.log(agentOptions
  ? `[bridge] console agents: ${agentOptions.command} ${agentOptions.args.join(' ')} in ${agentOptions.cwd}`
  : '[bridge] console agents disabled (set HAUNTED_CREW_WORKSPACE to enable)');
if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
  console.warn('[bridge] WARNING: bound to a non-loopback address. Tokens travel in plain HTTP;');
  console.warn('[bridge]          put a TLS reverse proxy (e.g. Caddy) in front before exposing to the internet.');
}

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[bridge] ${signal}, shutting down`);
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();
  await bridge.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
