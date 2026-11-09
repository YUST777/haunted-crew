#!/usr/bin/env node
// One command to set everything up:  haunted-crew [project-folder] [--demo] [--port 8787] [--host 127.0.0.1]
//   1. installs the Kiro hooks into the project (so Kiro IDE/CLI agents show up as ghosts)
//   2. checks your Kiro sign-in (or --demo: a built-in pretend agent, no account needed)
//   3. starts the bridge and tells Minecraft on this PC where it is (no tokens to copy)
//   4. prints a pairing code for Minecraft servers on other machines
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeDir, loadOrCreateTokens } from '../src/config.mjs';
import { createBridge } from '../src/server.mjs';
import { DEFAULT_MODEL } from '../src/agents.mjs';
import { hookFile } from './install-hooks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const valueFlags = new Set(['--port', '--host', '--model']);
const positional = args.filter((a, i) => !a.startsWith('--') && !valueFlags.has(args[i - 1]));

if (flag('help')) {
  console.log('usage: haunted-crew [project-folder] [--demo] [--port 8787] [--host 127.0.0.1] [--no-hooks] [--trust-all-tools] [--model claude-haiku-5.5] [--mcp]');
  process.exit(0);
}

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, ok: (s) => `\x1b[32m${s}\x1b[0m`, warn: (s) => `\x1b[33m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, purple: (s) => `\x1b[35m${s}\x1b[0m` };
const step = (n, text) => console.log(`\n${c.purple(`[${n}]`)} ${c.bold(text)}`);

const demo = flag('demo');
const project = resolve(positional[0] ?? process.cwd());
const port = Number(option('port', process.env.PORT ?? 8787));
const host = option('host', process.env.HOST ?? '127.0.0.1');
const kiroCli = process.env.HAUNTED_CREW_KIRO_CLI || 'kiro-cli';

if (!existsSync(project) || !statSync(project).isDirectory()) {
  console.error(`Project folder not found: ${project}`);
  process.exit(1);
}

console.log(c.purple('\n  👻  Haunted Crew') + c.dim('  — your Kiro agents, haunting Minecraft\n'));
console.log(`  project  ${project}${demo ? c.warn('   (demo mode)') : ''}`);

step(1, 'Kiro hooks');
if (flag('no-hooks')) {
  console.log(c.dim('  skipped (--no-hooks)'));
} else {
  const target = join(project, '.kiro', 'hooks', 'haunted-crew.json');
  const content = JSON.stringify(hookFile(join(here, 'send-event.mjs')), null, 2) + '\n';
  const same = existsSync(target) && readFileSync(target, 'utf8') === content;
  if (!same) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  console.log(`  ${c.ok('✔')} ${same ? 'already installed' : 'installed'}: ${target}`);
  console.log(c.dim('    Agents you run in Kiro IDE / CLI on this project now appear as ghosts.'));
}

// Console ghosts run as the "haunted-crew" Kiro agent: same tools as the default agent, but no MCP
// servers unless --mcp. Kiro starts every MCP server once per session, which made each summon take
// seconds and a big crew start hundreds of processes; without them a session opens in about a second.
const model = option('model') ?? process.env.HAUNTED_CREW_MODEL ?? DEFAULT_MODEL;
if (!demo) {
  const target = join(project, '.kiro', 'agents', 'haunted-crew.json');
  const content = JSON.stringify({
    name: 'haunted-crew',
    description: 'A Haunted Crew ghost: a Kiro coding agent started from Minecraft (written by haunted-crew)',
    model,
    tools: ['*'],
    allowedTools: ['read', 'glob', 'grep'],
    resources: ['file://README.md', 'file://AGENTS.md', 'file://.kiro/steering/**/*.md'],
    includeMcpJson: flag('mcp'),
    mcpServers: {},
  }, null, 2) + '\n';
  if (!existsSync(target) || readFileSync(target, 'utf8') !== content) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

const tokens = loadOrCreateTokens();
const agentOptions = {
  command: demo ? join(here, 'demo-agent.mjs') : kiroCli,
  args: ['acp', ...(demo ? [] : ['--agent', 'haunted-crew']), ...(flag('trust-all-tools') ? ['--trust-all-tools'] : [])],
  cwd: project,
  model,
};
const bridge = createBridge({ tokens, agentOptions, kiroOptions: { command: kiroCli, demo } });

step(2, 'Kiro account');
const kiro = await bridge.kiroStatus();
if (kiro.demo) console.log(`  ${c.ok('✔')} demo mode: agents are pretend, no Kiro account needed`);
else if (kiro.installed === false) console.log(`  ${c.warn('!')} kiro-cli not found. Install it from https://kiro.dev/downloads, or run with --demo`);
else if (!kiro.signedIn) console.log(`  ${c.warn('!')} not signed in yet. Press K in Minecraft → "Sign in to Kiro", or run: kiro-cli login`);
else console.log(`  ${c.ok('✔')} signed in${kiro.user ? `: ${kiro.user}` : ''}`);

step(3, 'Bridge');
let addr;
try {
  addr = await bridge.listen(port, host);
} catch (err) {
  console.error(`  ✖ could not listen on ${host}:${port} (${err.code ?? err.message}). Try --port 8788`);
  process.exit(1);
}
if (kiro.signedIn || kiro.demo) bridge.warmUpAgents(); // spare agent sessions get ready in the background (after listen: they need the bridge URL for their crew tools)
const localUrl = `ws://127.0.0.1:${addr.port}/stream`;
const discovery = join(homeDir(), 'bridge.json');
mkdirSync(homeDir(), { recursive: true, mode: 0o700 });
writeFileSync(discovery, JSON.stringify({ url: localUrl, project, pid: process.pid }, null, 2) + '\n', { mode: 0o600 });
console.log(`  ${c.ok('✔')} running on ${host}:${addr.port}`);
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.log(c.warn('  ! reachable from the network: put it behind TLS (wss://) before using it over the internet.'));
}

console.log(`  ${c.ok('✔')} dashboard: ${c.purple(`http://127.0.0.1:${addr.port}/#token=${tokens.view}`)}`);
if (tokens.command) {
  console.log(`  ${c.ok('✔')} workflows: ${c.purple(`http://127.0.0.1:${addr.port}/workflows#token=${tokens.command}`)}`);
  console.log(c.dim('    (draw agent workflows; this link can start ghosts, keep it to yourself)'));
}
console.log(c.dim('    (read-only link, also shown on the big screen in the Haunted Office)'));

step(4, 'Minecraft');
console.log(`  ${c.bold('Same PC:')} open a ${c.bold('Haunted Office')} world and press ${c.bold('K')}. It connects by itself.`);
const showCode = () => {
  const { code } = bridge.pairingCode();
  const where = host === '127.0.0.1' ? '<this-pc-address>' : host;
  console.log(`  ${c.bold('Other server:')} in Minecraft run  ${c.purple(`/crew pair ${code} ws://${where}:${addr.port}/stream`)}`);
  console.log(c.dim('    (code works once, for 10 minutes; a new one is printed when it expires)'));
};
showCode();
const refresh = setInterval(showCode, 10 * 60_000);
refresh.unref();

console.log(c.dim('\n  Ctrl+C to stop.\n'));

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try {
    const cur = JSON.parse(readFileSync(discovery, 'utf8'));
    if (cur.pid === process.pid) rmSync(discovery);
  } catch {
    // already gone
  }
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();
  await bridge.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
