import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function homeDir(env = process.env) {
  return env.HAUNTED_CREW_HOME || join(homedir(), '.haunted-crew');
}

export function tokensPath(env = process.env) {
  return join(homeDir(env), 'tokens.json');
}

const newToken = () => randomBytes(32).toString('base64url');

// Three roles: `ingest` may post events (Kiro hooks), `command` may start and prompt console agents
// (the Minecraft server, for ops), `view` may only watch (mod, dashboard, friends).
// Env vars win so servers and CI can inject secrets without touching disk.
export function loadOrCreateTokens(env = process.env) {
  const file = tokensPath(env);
  let tokens = {};
  if (existsSync(file)) {
    tokens = JSON.parse(readFileSync(file, 'utf8'));
  }
  let changed = false;
  for (const role of ['ingest', 'command', 'view']) {
    if (typeof tokens[role] !== 'string' || tokens[role].length < 32) {
      tokens[role] = newToken();
      changed = true;
    }
  }
  if (changed) {
    mkdirSync(homeDir(env), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(tokens, null, 2) + '\n', { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return {
    ingest: env.HAUNTED_CREW_INGEST_TOKEN || tokens.ingest,
    command: env.HAUNTED_CREW_COMMAND_TOKEN || tokens.command,
    view: env.HAUNTED_CREW_VIEW_TOKEN || tokens.view,
  };
}

export function serverConfig(env = process.env) {
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  return { host: env.HOST || '127.0.0.1', port };
}

// Console agents run `kiro-cli acp` in this project folder. Unset = agent runner disabled.
export function agentConfig(env = process.env) {
  if (!env.HAUNTED_CREW_WORKSPACE) return null;
  const args = ['acp'];
  if (env.HAUNTED_CREW_TRUST_ALL_TOOLS === '1') args.push('--trust-all-tools');
  return { command: env.HAUNTED_CREW_KIRO_CLI || 'kiro-cli', args, cwd: env.HAUNTED_CREW_WORKSPACE };
}
