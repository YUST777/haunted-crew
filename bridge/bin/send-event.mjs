#!/usr/bin/env node
// Called by Kiro hooks: `node send-event.mjs <Trigger>` with the hook event JSON on stdin.
// Rules (Kiro hook semantics):
//   - Always exit 0. Exit 2 blocks the agent's tool/prompt; in Crew any non-zero PreToolUse blocks.
//   - Print nothing to stdout. For SessionStart/UserPromptSubmit stdout is injected into the agent's context.
//   - Never wait long. If the bridge is down, drop the event.
import { readFileSync } from 'node:fs';
import { tokensPath } from '../src/config.mjs';

const MAX_STDIN = 1024 * 1024;
const TIMEOUT_MS = Number(process.env.HAUNTED_CREW_TIMEOUT_MS ?? 800);

async function readStdin() {
  if (process.stdin.isTTY) return '{}';
  const chunks = [];
  let size = 0;
  for await (const c of process.stdin) {
    size += c.length;
    if (size > MAX_STDIN) break; // too big: send what we have; bridge rejects invalid JSON harmlessly
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8') || '{}';
}

function ingestToken() {
  if (process.env.HAUNTED_CREW_INGEST_TOKEN) return process.env.HAUNTED_CREW_INGEST_TOKEN;
  return JSON.parse(readFileSync(tokensPath(), 'utf8')).ingest;
}

try {
  const trigger = process.argv[2] || process.env.KIROCREW_HOOK_EVENT || '';
  const body = await readStdin();
  const url = new URL('/event', process.env.HAUNTED_CREW_URL || 'http://127.0.0.1:8787');
  await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ingestToken()}`,
      'x-kiro-trigger': trigger,
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
} catch (err) {
  if (process.env.HAUNTED_CREW_DEBUG) process.stderr.write(`[haunted-crew] ${err.message}\n`);
}
process.exit(0);
