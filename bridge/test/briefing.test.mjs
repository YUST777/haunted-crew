import test from 'node:test';
import assert from 'node:assert/strict';
import { crewBriefing } from '../src/briefing.mjs';

test('briefing names the agent, project and features', () => {
  const b = crewBriefing({ name: 'Coder', projectDir: '/work/app', worktree: true, crewTools: true });
  assert.match(b, /"Coder"/);
  assert.match(b, /\/work\/app/);
  assert.match(b, /own git branch/);
  assert.match(b, /Workflows/);
  assert.match(b, /Reviewed merges/);
  assert.match(b, /send_message/);
});

test('briefing says when crew tools are missing', () => {
  assert.match(crewBriefing({ name: 'x' }), /not attached/);
});
