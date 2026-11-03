import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventError, normalize, safePath, toolCategory } from '../src/normalize.mjs';

test('maps tool events and strips payload contents', () => {
  const e = normalize(
    {
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      cwd: '/home/me/proj',
      tool_name: 'fs_write',
      tool_input: { path: '/home/me/proj/src/a.ts', content: 'SECRET=123' },
      tool_response: { success: false, output: 'boom' },
    },
    { now: () => 42 },
  );
  assert.equal(e.kind, 'tool_end');
  assert.equal(e.session, 's1');
  assert.equal(e.category, 'write');
  assert.equal(e.ok, false);
  assert.equal(e.file, 'src/a.ts');
  assert.equal(e.ts, 42);
  assert.ok(!JSON.stringify(e).includes('SECRET'));
  assert.ok(!JSON.stringify(e).includes('boom'));
});

test('header trigger wins and legacy names map', () => {
  assert.equal(normalize({}, { trigger: 'agentSpawn' }).kind, 'session_start');
  assert.equal(normalize({ hook_event_name: 'Stop' }, { trigger: 'PreTaskExec' }).kind, 'task_start');
  assert.equal(normalize({ hook_event_name: 'PostFileSave', file_path: 'README.md' }).file, 'README.md');
});

test('prompt text is never forwarded', () => {
  const e = normalize({ hook_event_name: 'UserPromptSubmit', prompt: 'my password is hunter2' });
  assert.equal(e.kind, 'prompt');
  assert.ok(!JSON.stringify(e).includes('hunter2'));
});

test('rejects unknown triggers and non-objects', () => {
  assert.throws(() => normalize({ hook_event_name: 'Nope' }), EventError);
  assert.throws(() => normalize([]), EventError);
  assert.throws(() => normalize(null), EventError);
});

test('tool categories', () => {
  assert.equal(toolCategory('read_file'), 'read');
  assert.equal(toolCategory('grep_search'), 'read');
  assert.equal(toolCategory('execute_bash'), 'shell');
  assert.equal(toolCategory('execute_pwsh'), 'shell');
  assert.equal(toolCategory('str_replace'), 'write');
  assert.equal(toolCategory('web_search'), 'web');
  assert.equal(toolCategory('mcp_git_status'), 'mcp');
  assert.equal(toolCategory('use_subagent'), 'subagent');
  assert.equal(toolCategory('x', ['shell', '@builtin']), 'shell');
  assert.equal(toolCategory('weird_tool'), 'other');
});

test('paths never leak outside the project', () => {
  assert.equal(safePath('/home/me/proj/a/b.js', '/home/me/proj'), 'a/b.js');
  assert.equal(safePath('/etc/passwd', '/home/me/proj'), 'passwd');
  assert.equal(safePath('/home/me/other/x.js', '/home/me/proj'), 'x.js');
});

test('control characters and long strings are cleaned', () => {
  const e = normalize({ hook_event_name: 'PreTaskExec', task: { title: 'a\u0007b'.padEnd(500, 'x') } });
  assert.ok(!e.task.includes('\u0007'));
  assert.ok(e.task.length <= 120);
});
