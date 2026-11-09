import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChannels } from '../src/channels.mjs';

const setup = (opts) => {
  const c = createChannels(opts);
  const ch = c.create({ name: 'ops', members: ['lead', 'a', 'b'], lead: 'lead' });
  return { c, id: ch.id };
};

test('create validates name, members and lead', () => {
  const c = createChannels();
  assert.throws(() => c.create({ name: '', members: ['x', 'y'], lead: 'x' }), /channel name must be 1-40/);
  assert.throws(() => c.create({ name: 'n'.repeat(41), members: ['x', 'y'], lead: 'x' }), /channel name must be 1-40/);
  assert.throws(() => c.create({ name: 'n', members: ['x'], lead: 'x' }), /2-10 names/);
  assert.throws(() => c.create({ name: 'n', members: Array.from({ length: 11 }, (_, i) => `m${i}`), lead: 'm0' }), /2-10 names/);
  assert.throws(() => c.create({ name: 'n', members: ['x', 'x'], lead: 'x' }), /must be unique/);
  assert.throws(() => c.create({ name: 'n', members: ['x', 'y'], lead: 'z' }), /lead must be one of the members/);
});

test('post requires a member and enforces text size; keeps last 200 messages', () => {
  const { c, id } = setup();
  assert.throws(() => c.post(id, 'stranger', 'hi'), /not a member/);
  assert.throws(() => c.post(id, 'a', ''), /message text must be 1-4000/);
  assert.throws(() => c.post(id, 'a', 'x'.repeat(4001)), /message text must be 1-4000/);
  for (let i = 0; i < 205; i++) c.post(id, 'a', `m${i}`);
  const msgs = c.get(id).messages;
  assert.equal(msgs.length, 200);
  assert.equal(msgs[0].text, 'm5');
  assert.equal(msgs[199].text, 'm204');
});

test('assign is lead-only and validates assignee and resources', () => {
  const { c, id } = setup();
  const args = { to: 'b', task: 'do it', expectedResult: 'done' };
  assert.throws(() => c.assign(id, 'a', args), /only the lead "lead" can assign/);
  assert.throws(() => c.assign(id, 'lead', { ...args, to: 'nobody' }), /not a member/);
  assert.throws(() => c.assign(id, 'lead', { ...args, to: 'lead' }), /lead cannot be assigned/);
  assert.throws(() => c.assign(id, 'lead', { ...args, resources: 'db' }), /resources must be an array of strings/);
  assert.throws(() => c.assign(id, 'lead', { ...args, resources: [42] }), /resources must be an array of strings/);
  const t = c.assign(id, 'lead', { ...args, resources: ['db'] });
  assert.equal(t.status, 'open');
  assert.equal(t.from, 'lead');
  assert.deepEqual(t.dependsOn, []);
  assert.equal(t.result, null);
});

test('resource lock blocks other agents and auto-unblocks when holder finishes', () => {
  const { c, id } = setup();
  const t1 = c.assign(id, 'lead', { to: 'a', task: 'build', expectedResult: 'ok', resources: ['db'] });
  const t2 = c.assign(id, 'lead', { to: 'b', task: 'migrate', expectedResult: 'ok', resources: ['db', 'x'] });
  assert.equal(t2.status, 'blocked');
  assert.deepEqual(t2.dependsOn, [t1.id]);
  // Same agent holding the resource does not block.
  const t3 = c.assign(id, 'lead', { to: 'a', task: 'more', expectedResult: 'ok', resources: ['db'] });
  assert.equal(t3.status, 'open');
  const { task, unblocked } = c.result(id, 'a', t1.id, 'built');
  assert.equal(task.status, 'done');
  assert.equal(task.result, 'built');
  assert.deepEqual(unblocked, [t2.id]);
  assert.equal(c.get(id).tasks.find((t) => t.id === t2.id).status, 'open');
});

test('blocked task waits for every dependency', () => {
  const { c, id } = setup();
  const t1 = c.assign(id, 'lead', { to: 'a', task: 'x', expectedResult: 'x', resources: ['r1'] });
  const t2 = c.assign(id, 'lead', { to: 'a', task: 'y', expectedResult: 'y', resources: ['r2'] });
  const t3 = c.assign(id, 'lead', { to: 'b', task: 'z', expectedResult: 'z', resources: ['r1', 'r2'] });
  assert.deepEqual(t3.dependsOn, [t1.id, t2.id]);
  assert.deepEqual(c.result(id, 'a', t1.id, 'ok').unblocked, []);
  assert.deepEqual(c.result(id, 'a', t2.id, 'ok').unblocked, [t3.id]);
});

test('nesting lock: lead cannot assign while answering a clarifying reply', () => {
  const { c, id } = setup();
  const t1 = c.assign(id, 'lead', { to: 'a', task: 'deploy', expectedResult: 'ok' });
  const r = c.reply(id, 'a', t1.id, 'which env?');
  assert.throws(() => c.assign(id, 'lead', { to: 'b', task: 'x', expectedResult: 'y' }), /answering a clarifying reply/);
  c.answer(id, r.id, 'prod');
  const t2 = c.assign(id, 'lead', { to: 'b', task: 'x', expectedResult: 'y' });
  assert.equal(t2.status, 'open');
});

test('result is only accepted from the assignee, only once, and not for blocked tasks', () => {
  const { c, id } = setup();
  const t1 = c.assign(id, 'lead', { to: 'a', task: 'x', expectedResult: 'x', resources: ['r'] });
  const t2 = c.assign(id, 'lead', { to: 'b', task: 'y', expectedResult: 'y', resources: ['r'] });
  assert.throws(() => c.result(id, 'b', t1.id, 'nope'), /only "a" can report/);
  assert.throws(() => c.result(id, 'b', t2.id, 'nope'), /blocked, not open/);
  c.result(id, 'a', t1.id, 'ok');
  assert.throws(() => c.result(id, 'a', t1.id, 'again'), /done, not open/);
  assert.throws(() => c.result(id, 'a', 'task_nope', 'x'), /does not exist/);
});

test('reply and answer flow creates and closes a lead-bound reply task', () => {
  const { c, id } = setup();
  const t1 = c.assign(id, 'lead', { to: 'a', task: 'deploy', expectedResult: 'ok' });
  assert.throws(() => c.reply(id, 'b', t1.id, 'q?'), /only "a" can ask/);
  const r = c.reply(id, 'a', t1.id, 'which env?');
  assert.equal(r.isReply, true);
  assert.equal(r.to, 'lead');
  assert.equal(r.replyTo, t1.id);
  assert.deepEqual(c.openTasks(id, 'lead').map((t) => t.id), [r.id]);
  assert.throws(() => c.result(id, 'lead', r.id, 'x'), /close it with answer/);
  assert.throws(() => c.answer(id, t1.id, 'x'), /is not a reply/);
  const { task } = c.answer(id, r.id, 'prod');
  assert.equal(task.status, 'done');
  assert.equal(task.result, 'prod');
  assert.throws(() => c.answer(id, r.id, 'again'), /done, not open/);
});

test('transfer is lead-only and requires a member', () => {
  const { c, id } = setup();
  assert.throws(() => c.transfer(id, 'a', 'a'), /only the lead/);
  assert.throws(() => c.transfer(id, 'lead', 'nobody'), /not a member/);
  c.transfer(id, 'lead', 'a');
  assert.equal(c.get(id).lead, 'a');
  assert.throws(() => c.assign(id, 'lead', { to: 'b', task: 'x', expectedResult: 'y' }), /only the lead "a"/);
  assert.equal(c.assign(id, 'a', { to: 'b', task: 'x', expectedResult: 'y' }).status, 'open');
});

test('remember caps notes at 50, validates text, and forget frees a slot', () => {
  const { c, id } = setup();
  assert.throws(() => c.remember(id, 'stranger', 'x'), /not a member/);
  assert.throws(() => c.remember(id, 'a', 'x'.repeat(501)), /note text must be 1-500/);
  const notes = Array.from({ length: 50 }, (_, i) => c.remember(id, 'a', `n${i}`));
  assert.throws(() => c.remember(id, 'a', 'one more'), /already has 50 notes/);
  c.forget(id, notes[0].id);
  assert.equal(c.get(id).notes.length, 49);
  c.remember(id, 'a', 'fits now');
  assert.throws(() => c.forget(id, 'note_nope'), /does not exist/);
});

test('openTasks and summary report state for prompts', () => {
  const { c, id } = setup();
  const t1 = c.assign(id, 'lead', { to: 'a', task: 'x', expectedResult: 'x', resources: ['r'] });
  c.assign(id, 'lead', { to: 'b', task: 'y', expectedResult: 'y', resources: ['r'] });
  c.remember(id, 'a', 'use staging db');
  assert.deepEqual(c.openTasks(id, 'a').map((t) => t.id), [t1.id]);
  assert.deepEqual(c.openTasks(id, 'b'), []);
  const s = c.summary(id);
  assert.match(s, /Lead: lead/);
  assert.match(s, /Members: lead, a, b/);
  assert.match(s, /Tasks: 1 open, 1 blocked, 0 done/);
  assert.match(s, /- use staging db/);
});

test('get and remove reject unknown channels', () => {
  const { c, id } = setup();
  assert.throws(() => c.get('ch_nope'), /does not exist/);
  assert.equal(c.list().length, 1);
  c.remove(id);
  assert.equal(c.list().length, 0);
  assert.throws(() => c.remove(id), /does not exist/);
});

test('persistence round trip through .haunted-crew/channels.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'channels-'));
  const { c, id } = setup({ root });
  c.post(id, 'a', 'hello');
  const t1 = c.assign(id, 'lead', { to: 'a', task: 'x', expectedResult: 'x', resources: ['r'] });
  c.assign(id, 'lead', { to: 'b', task: 'y', expectedResult: 'y', resources: ['r'] });
  c.remember(id, 'a', 'note');
  c.result(id, 'a', t1.id, 'ok');
  const file = join(root, '.haunted-crew', 'channels.json');
  assert.ok(existsSync(file));
  assert.equal(existsSync(`${file}.tmp`), false);
  const reloaded = createChannels({ root });
  assert.deepEqual(reloaded.get(id), c.get(id));
  assert.equal(reloaded.get(id).tasks.find((t) => t.id !== t1.id).status, 'open');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).channels.length, 1);
});
