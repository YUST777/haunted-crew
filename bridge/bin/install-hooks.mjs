#!/usr/bin/env node
// Writes .kiro/hooks/haunted-crew.json into a project (or ~/.kiro/hooks with --global)
// so every Kiro IDE / CLI V3 event is forwarded to the bridge.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TRIGGERS = [
  'SessionStart', 'UserPromptSubmit', 'Stop',
  'PreToolUse', 'PostToolUse',
  'PostFileCreate', 'PostFileSave', 'PostFileDelete',
  'PreTaskExec', 'PostTaskExec',
];

export function hookFile(senderPath) {
  return {
    version: 'v1',
    hooks: TRIGGERS.map((trigger) => ({
      name: `haunted-crew-${trigger}`,
      description: 'Forward event metadata to the Haunted Crew bridge (always exits 0, prints nothing).',
      trigger,
      action: { type: 'command', command: `node ${JSON.stringify(senderPath)} ${trigger}` },
      timeout: 5,
    })),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const base = args.includes('--global') ? homedir() : resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const sender = join(dirname(fileURLToPath(import.meta.url)), 'send-event.mjs');
  const target = join(base, '.kiro', 'hooks', 'haunted-crew.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(hookFile(sender), null, 2) + '\n');
  console.log(`Wrote ${target}`);
}
