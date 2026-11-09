import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compact, estimateTokens, needsCompaction, seed, split, summaryPrompt } from '../src/compaction.mjs';

const msg = (role, text) => ({ role, text });

test('estimateTokens is ceil(length / 4)', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
});

test('needsCompaction compares the summed estimate to the budget', () => {
  const m = [msg('user', 'a'.repeat(400)), msg('assistant', 'b'.repeat(400))];
  assert.equal(needsCompaction(m, { budget: 200 }), false);
  assert.equal(needsCompaction(m, { budget: 199 }), true);
  assert.equal(needsCompaction([msg('user', 'x'.repeat(24004))]), true);
  assert.equal(needsCompaction([]), false);
});

test('split separates old messages from the last keepLast', () => {
  const list = Array.from({ length: 8 }, (_, i) => msg('user', String(i)));
  const { old, recent } = split(list, { keepLast: 3 });
  assert.deepEqual(recent.map((m) => m.text), ['5', '6', '7']);
  assert.equal(old.length, 5);
  assert.equal(split(list).recent.length, 6);
  assert.equal(split(list, { keepLast: 0 }).recent.length, 0);
});

test('summaryPrompt is capped at 12000 chars and truncates the oldest text first', () => {
  const old = Array.from({ length: 10 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `m${i} ` + 'x'.repeat(3000)));
  const p = summaryPrompt(old);
  assert.ok(p.length <= 12000);
  assert.ok(p.includes('[truncated]'));
  assert.ok(p.includes('m9 '));
  assert.ok(!p.includes('m0 '));
});

test('summaryPrompt includes the previous summary when given', () => {
  const p = summaryPrompt([msg('user', 'hi')], 'PREV SUMMARY');
  assert.ok(p.includes('Previous summary:\nPREV SUMMARY'));
  assert.ok(p.includes('user: hi'));
  assert.ok(p.includes('goals'));
});

test('seed is capped at 12000 chars and keeps the newest messages', () => {
  const recent = Array.from({ length: 20 }, (_, i) => msg('user', `r${i} ` + 'y'.repeat(2000)));
  const s = seed('short summary', recent);
  assert.ok(s.length <= 12000);
  assert.ok(s.startsWith('Summary of earlier conversation:\nshort summary\n\nRecent messages:\n'));
  assert.ok(s.includes('r19 '));
  assert.equal(
    seed('S', [msg('user', 'hello'), msg('assistant', 'hi')]),
    'Summary of earlier conversation:\nS\n\nRecent messages:\nuser: hello\nassistant: hi',
  );
});

test('compact returns messages untouched when under budget', async () => {
  const m = [msg('user', 'short')];
  let called = false;
  const r = await compact(m, async () => {
    called = true;
    return 'x';
  });
  assert.equal(called, false);
  assert.deepEqual(r, { messages: m, summary: null });
});

test('compact summarizes old messages and returns summary, seed and recent', async () => {
  const m = Array.from({ length: 10 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `turn ${i} ` + 'z'.repeat(400)));
  let prompt;
  const r = await compact(m, async (p) => {
    prompt = p;
    return '  - goal: X\n  ';
  }, { budget: 300, keepLast: 4 });
  assert.ok(prompt.includes('turn 5 '));
  assert.ok(!prompt.includes('turn 9 '));
  assert.equal(r.summary, '- goal: X');
  assert.deepEqual(r.recent, m.slice(-4));
  assert.ok(r.seed.startsWith('Summary of earlier conversation:\n- goal: X'));
  assert.ok(r.seed.includes('turn 9 '));
});

test('compact returns messages unchanged with error when summarize throws', async () => {
  const m = Array.from({ length: 4 }, (_, i) => msg('user', `t${i} ` + 'q'.repeat(200)));
  const r = await compact(m, async () => {
    throw new Error('boom');
  }, { budget: 10, keepLast: 1 });
  assert.equal(r.messages, m);
  assert.equal(r.summary, null);
  assert.match(r.error, /boom/);
});

test('compact returns messages unchanged with error when summary is empty', async () => {
  const m = Array.from({ length: 4 }, (_, i) => msg('user', `t${i} ` + 'q'.repeat(200)));
  const r = await compact(m, async () => '   ', { budget: 10, keepLast: 1 });
  assert.equal(r.messages, m);
  assert.equal(r.summary, null);
  assert.match(r.error, /empty/);
});
