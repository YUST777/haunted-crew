#!/usr/bin/env node
// Kiro PreToolUse hook for shell tools (.kiro/hooks/guard-shell.json).
// Blocks the few commands that can lose work in this repo: force pushes, hard resets, cleaning
// untracked files, and deleting the whole checkout. Exit 2 blocks the tool and shows stderr to the
// agent; exit 0 lets it run. Anything it cannot parse is allowed, so a payload change never jams Kiro.
import { readFileSync } from 'node:fs';

const RULES = [
  [/\bgit\s+push\b[^\n;&|]*(\s--force(?!-with-lease)\b|\s-f\b|\s\+\S)/, 'force push rewrites the shared history'],
  [/\bgit\s+reset\s+[^\n;&|]*--hard\b/, 'git reset --hard throws away uncommitted work'],
  [/\bgit\s+clean\s+[^\n;&|]*-[a-z]*f/, 'git clean -f deletes untracked files (assets, renders, .kiro)'],
  [/\bgit\s+(checkout|restore)\s+[^\n;&|]*(\s--\s+\.|\s\.)\s*($|[;&|])/, 'checking out "." discards every local change'],
  [/\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\.|\.\/|\*)(\s|$|[;&|])/, 'rm -r on the root, home or the whole checkout'],
];

let input = '';
try {
  input = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

let command = '';
try {
  const e = JSON.parse(input);
  const t = e.tool_input ?? e.toolInput ?? e.input ?? {};
  command = String(t.command ?? t.cmd ?? e.command ?? '');
} catch {
  process.exit(0);
}

for (const [re, why] of RULES) {
  if (re.test(command)) {
    process.stderr.write(`Blocked by .kiro/hooks/guard-shell.json: ${why}.\nCommand: ${command.slice(0, 200)}\nAsk the user to run it themselves if it is really needed.\n`);
    process.exit(2);
  }
}
process.exit(0);
