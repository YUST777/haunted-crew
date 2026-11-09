import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoutines } from '../src/routines.mjs';

const T0 = new Date(2026, 0, 10, 8, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;

function setup({ root, start, timers } = {}) {
  const h = { clock: T0, calls: [] };
  const r = createRoutines({
    root,
    start: start ?? ((workflowId, task) => { h.calls.push({ workflowId, task }); }),
    now: () => h.clock,
    setTimer: timers?.setTimer,
    clearTimer: timers?.clearTimer,
  });
  return { r, h };
}

const sign = (secret, body) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

test('valid schedules are accepted and next run is computed', () => {
  const { r } = setup();
  assert.equal(r.create({ name: 'a', workflowId: 'w', task: 't', schedule: 'every 5m' }).nextRun, T0 + 5 * MIN);
  assert.equal(r.create({ name: 'b', workflowId: 'w', task: 't', schedule: 'every 2h' }).nextRun, T0 + 2 * HOUR);
  const daily = r.create({ name: 'c', workflowId: 'w', task: 't', schedule: 'daily 09:30' });
  assert.equal(daily.nextRun, new Date(2026, 0, 10, 9, 30).getTime());
  assert.equal(daily.enabled, true);
  assert.equal(daily.lastRun, null);
});

test('invalid schedules and fields are rejected', () => {
  const { r } = setup();
  const bad = ['', 'weekly', 'every 0m', 'every 5d', 'every 5', 'every 1.5h', 'daily 9:30', 'daily 24:00', 'daily 12:60', 42];
  for (const schedule of bad) {
    assert.throws(() => r.create({ name: 'x', workflowId: 'w', task: 't', schedule }), Error, String(schedule));
  }
  assert.throws(() => r.create({ name: '', workflowId: 'w', task: 't', schedule: 'every 5m' }), /name/);
  assert.throws(() => r.create({ name: 'x'.repeat(61), workflowId: 'w', task: 't', schedule: 'every 5m' }), /name/);
  assert.throws(() => r.create({ name: 'x', workflowId: 'w', task: 'y'.repeat(4001), schedule: 'every 5m' }), /task/);
});

test('daily routine advances to the next local day after running', () => {
  const { r, h } = setup();
  const slot = new Date(2026, 0, 10, 9, 30).getTime();
  r.create({ name: 'd', workflowId: 'w', task: 't', schedule: 'daily 09:30' });
  h.clock = slot;
  r.tick();
  assert.equal(h.calls.length, 1);
  assert.equal(r.list()[0].nextRun, new Date(2026, 0, 11, 9, 30).getTime());
});

test('tick starts a due every-N routine once per slot and skips missed slots', () => {
  const { r, h } = setup();
  r.create({ name: 'e', workflowId: 'wf', task: 'do it', schedule: 'every 5m' });
  h.clock = T0 + 5 * MIN;
  r.tick();
  r.tick();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], { workflowId: 'wf', task: 'do it' });
  assert.equal(r.list()[0].nextRun, T0 + 10 * MIN);
  assert.equal(r.list()[0].lastRun, T0 + 5 * MIN);

  h.clock = T0 + 15 * MIN; // slots at 10m and 15m missed in between
  r.tick();
  assert.equal(h.calls.length, 2);
  assert.equal(r.list()[0].nextRun, T0 + 20 * MIN);
});

test('disabled routines are skipped and re-enabling does not burst', () => {
  const { r, h } = setup();
  const { id } = r.create({ name: 'f', workflowId: 'w', task: 't', schedule: 'every 1m' });
  r.setEnabled(id, false);
  h.clock = T0 + 10 * MIN;
  r.tick();
  assert.equal(h.calls.length, 0);
  r.setEnabled(id, true);
  r.tick();
  assert.equal(h.calls.length, 0);
  h.clock += MIN;
  r.tick();
  assert.equal(h.calls.length, 1);
  assert.throws(() => r.setEnabled('nope', true), /no such routine/);
});

test('a throwing start is recorded on the routine, not thrown from tick', () => {
  const { r, h } = setup({ start: () => { throw new Error('boom'); } });
  r.create({ name: 'g', workflowId: 'w', task: 't', schedule: 'every 1m' });
  h.clock = T0 + MIN;
  assert.doesNotThrow(() => r.tick());
  const [routine] = r.list();
  assert.equal(routine.lastError, 'boom');
  assert.equal(routine.lastRun, T0 + MIN);
});

test('webhook accepts a valid signature and appends the payload to the task', () => {
  const { r, h } = setup();
  const hook = r.createWebhook({ name: 'hook', workflowId: 'wf', task: 'handle' });
  assert.equal(hook.path, `/hooks/${hook.id}`);
  assert.match(hook.secret, /^[A-Za-z0-9_-]{43}$/);
  r.trigger(hook.id, '{"a":1}', sign(hook.secret, '{"a":1}'));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].workflowId, 'wf');
  assert.equal(h.calls[0].task, 'handle\n\nWebhook payload:\n{"a":1}');
});

test('webhook rejects bad, missing and wrong-length signatures and unknown ids', () => {
  const { r, h } = setup();
  const hook = r.createWebhook({ name: 'hook', workflowId: 'wf', task: 'handle' });
  assert.throws(() => r.trigger(hook.id, 'body', sign('wrong-secret', 'body')), /bad signature/);
  assert.throws(() => r.trigger(hook.id, 'body', undefined), /bad signature/);
  assert.throws(() => r.trigger(hook.id, 'body', 'sha256=abc'), /bad signature/);
  assert.throws(() => r.trigger(hook.id, 'other', sign(hook.secret, 'body')), /bad signature/);
  assert.throws(() => r.trigger('rt_missing', 'body', sign(hook.secret, 'body')), /no such webhook/);
  assert.equal(h.calls.length, 0);
});

test('a scheduled routine cannot be triggered as a webhook', () => {
  const { r } = setup();
  const { id } = r.create({ name: 's', workflowId: 'w', task: 't', schedule: 'every 1m' });
  assert.throws(() => r.trigger(id, 'body', 'sha256=00'), /no such webhook/);
});

test('webhook triggers are rate limited to one per 5 seconds', () => {
  const { r, h } = setup();
  const hook = r.createWebhook({ name: 'hook', workflowId: 'wf', task: 'handle' });
  const sig = sign(hook.secret, 'body');
  r.trigger(hook.id, 'body', sig);
  h.clock = T0 + 4_999;
  assert.throws(() => r.trigger(hook.id, 'body', sig), /too many requests/);
  assert.equal(h.calls.length, 1);
  h.clock = T0 + 5_000;
  r.trigger(hook.id, 'body', sig);
  assert.equal(h.calls.length, 2);
});

test('webhook payload is capped at 2000 characters', () => {
  const { r, h } = setup();
  const hook = r.createWebhook({ name: 'hook', workflowId: 'wf', task: 'T' });
  const body = 'x'.repeat(3000);
  r.trigger(hook.id, body, sign(hook.secret, body));
  assert.equal(h.calls[0].task, `T\n\nWebhook payload:\n${'x'.repeat(2000)}`);
});

test('secret is never included in list()', () => {
  const { r } = setup();
  const hook = r.createWebhook({ name: 'hook', workflowId: 'wf', task: 'handle' });
  const listed = r.list();
  assert.equal(listed.length, 1);
  assert.equal(Object.hasOwn(listed[0], 'secret'), false);
  assert.equal(JSON.stringify(listed).includes(hook.secret), false);
});

test('remove deletes a routine', () => {
  const { r } = setup();
  const { id } = r.create({ name: 'x', workflowId: 'w', task: 't', schedule: 'every 1h' });
  assert.equal(r.remove(id), true);
  assert.equal(r.remove(id), false);
  assert.equal(r.list().length, 0);
});

test('begin and end manage a 30 second unref-ed timer', () => {
  const calls = { set: [], cleared: [] };
  const handle = { unref() { this.unrefed = true; } };
  const { r } = setup({
    timers: {
      setTimer: (fn, ms) => { calls.set.push({ fn, ms }); return handle; },
      clearTimer: (h) => calls.cleared.push(h),
    },
  });
  r.begin();
  r.begin();
  assert.equal(calls.set.length, 1);
  assert.equal(calls.set[0].ms, 30_000);
  assert.equal(handle.unrefed, true);
  r.end();
  assert.deepEqual(calls.cleared, [handle]);
});

test('persistence round trip keeps routines and webhook secrets', () => {
  const root = mkdtempSync(join(tmpdir(), 'routines-'));
  const file = join(root, '.haunted-crew', 'routines.json');
  const first = setup({ root }).r;
  const sched = first.create({ name: 'sched', workflowId: 'w1', task: 't1', schedule: 'every 2h' });
  const hook = first.createWebhook({ name: 'hook', workflowId: 'w2', task: 't2' });
  assert.equal(existsSync(file), true);
  assert.equal(existsSync(`${file}.tmp`), false);

  const { r, h } = setup({ root });
  assert.deepEqual(r.list(), first.list());
  assert.equal(r.list().find((x) => x.id === sched.id).schedule, 'every 2h');

  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(raw.routines.find((x) => x.id === hook.id).secret, hook.secret);

  r.trigger(hook.id, 'ping', sign(hook.secret, 'ping'));
  assert.equal(h.calls[0].workflowId, 'w2');
});
