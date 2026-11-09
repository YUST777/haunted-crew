import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_MESSAGES = 200;
const MAX_NOTES = 50;
const MAX_TEXT = 4000;

// Modelled on OpenBot channel tools. Agents are identified by name strings.
const text = (value, label, max) => {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > max) {
    throw new Error(`${label} must be 1-${max} chars`);
  }
  return value.trim();
};

const newId = (prefix) => `${prefix}_${randomBytes(4).toString('hex')}`;

// Shared multi-agent channels. Sync API; every mutation is saved atomically when root is set.
export function createChannels({ root } = {}) {
  const file = root ? join(root, '.haunted-crew', 'channels.json') : null;
  const channels = new Map();
  if (file && existsSync(file)) {
    for (const c of JSON.parse(readFileSync(file, 'utf8')).channels ?? []) channels.set(c.id, c);
  }

  function save() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify({ channels: [...channels.values()] }, null, 2));
    renameSync(`${file}.tmp`, file);
  }

  function need(id) {
    const ch = channels.get(id);
    if (!ch) throw new Error(`channel ${id} does not exist`);
    return ch;
  }

  function member(ch, name, label = 'agent') {
    if (!ch.members.includes(name)) throw new Error(`${label} "${name}" is not a member of channel "${ch.name}"`);
  }

  function findTask(ch, taskId) {
    const t = ch.tasks.find((x) => x.id === taskId);
    if (!t) throw new Error(`task ${taskId} does not exist in channel "${ch.name}"`);
    return t;
  }

  // Marks the task done, then opens every blocked task whose dependencies are all done.
  function finish(ch, task, result) {
    task.status = 'done';
    task.result = result;
    const done = new Set(ch.tasks.filter((t) => t.status === 'done').map((t) => t.id));
    const unblocked = [];
    for (const t of ch.tasks) {
      if (t.status === 'blocked' && t.dependsOn.every((id) => done.has(id))) {
        t.status = 'open';
        unblocked.push(t.id);
      }
    }
    save();
    return { task, unblocked };
  }

  function create({ name, members, lead } = {}) {
    const n = text(name, 'channel name', 40);
    if (!Array.isArray(members) || members.length < 2 || members.length > 10) {
      throw new Error('members must be an array of 2-10 names');
    }
    const list = members.map((m) => text(m, 'member name', 40));
    if (new Set(list).size !== list.length) throw new Error('members must be unique');
    const l = text(lead, 'lead', 40);
    if (!list.includes(l)) throw new Error('lead must be one of the members');
    const ch = { id: newId('ch'), name: n, members: list, lead: l, messages: [], tasks: [], notes: [] };
    channels.set(ch.id, ch);
    save();
    return ch;
  }

  function post(channelId, from, body) {
    const ch = need(channelId);
    member(ch, from, 'sender');
    const msg = { id: newId('msg'), ts: new Date().toISOString(), from, text: text(body, 'message text', MAX_TEXT) };
    ch.messages = [...ch.messages, msg].slice(-MAX_MESSAGES);
    save();
    return msg;
  }

  function assign(channelId, from, { to, task, expectedResult, resources = [] } = {}) {
    const ch = need(channelId);
    if (from !== ch.lead) throw new Error(`only the lead "${ch.lead}" can assign tasks`);
    if (ch.tasks.some((t) => t.isReply && t.to === from && t.status === 'open')) {
      throw new Error(`"${from}" is answering a clarifying reply and cannot assign further tasks`);
    }
    member(ch, to, 'assignee');
    if (to === ch.lead) throw new Error('the lead cannot be assigned a task');
    if (!Array.isArray(resources) || resources.some((r) => typeof r !== 'string')) {
      throw new Error('resources must be an array of strings');
    }
    const res = resources.map((r) => text(r, 'resource', 200));
    const t = {
      id: newId('task'),
      from,
      to,
      task: text(task, 'task', MAX_TEXT),
      expectedResult: text(expectedResult, 'expectedResult', MAX_TEXT),
      resources: res,
      status: 'open',
      dependsOn: [],
      result: null,
    };
    // Resource lock: an open task of another agent holding the same resource blocks this one.
    const holders = ch.tasks.filter((o) => o.status === 'open' && o.to !== to && o.resources.some((r) => res.includes(r)));
    if (holders.length) {
      t.status = 'blocked';
      t.dependsOn = holders.map((h) => h.id);
    }
    ch.tasks.push(t);
    save();
    return t;
  }

  function result(channelId, agent, taskId, body) {
    const ch = need(channelId);
    const t = findTask(ch, taskId);
    if (t.isReply) throw new Error(`task ${taskId} is a reply; close it with answer()`);
    if (t.to !== agent) throw new Error(`only "${t.to}" can report the result of task ${taskId}`);
    if (t.status !== 'open') throw new Error(`task ${taskId} is ${t.status}, not open`);
    return finish(ch, t, text(body, 'result', MAX_TEXT));
  }

  function reply(channelId, from, taskId, body) {
    const ch = need(channelId);
    const t = findTask(ch, taskId);
    if (t.to !== from) throw new Error(`only "${t.to}" can ask a clarifying question on task ${taskId}`);
    if (t.isReply) throw new Error('cannot reply to a reply task');
    if (t.status !== 'open') throw new Error(`task ${taskId} is ${t.status}, not open`);
    const r = {
      id: newId('task'),
      from,
      to: ch.lead,
      task: text(body, 'reply', MAX_TEXT),
      expectedResult: 'answer to clarifying question',
      resources: [],
      status: 'open',
      dependsOn: [],
      result: null,
      isReply: true,
      replyTo: t.id,
    };
    ch.tasks.push(r);
    save();
    return r;
  }

  function answer(channelId, taskId, body) {
    const ch = need(channelId);
    const t = findTask(ch, taskId);
    if (!t.isReply) throw new Error(`task ${taskId} is not a reply`);
    if (t.status !== 'open') throw new Error(`reply ${taskId} is ${t.status}, not open`);
    return finish(ch, t, text(body, 'answer', MAX_TEXT));
  }

  function transfer(channelId, from, newLead) {
    const ch = need(channelId);
    if (from !== ch.lead) throw new Error(`only the lead "${ch.lead}" can transfer the channel`);
    member(ch, newLead, 'new lead');
    ch.lead = newLead;
    save();
    return ch;
  }

  function remember(channelId, from, body) {
    const ch = need(channelId);
    member(ch, from, 'author');
    if (ch.notes.length >= MAX_NOTES) throw new Error(`channel "${ch.name}" already has ${MAX_NOTES} notes`);
    const note = { id: newId('note'), from, text: text(body, 'note text', 500), ts: new Date().toISOString() };
    ch.notes.push(note);
    save();
    return note;
  }

  function forget(channelId, noteId) {
    const ch = need(channelId);
    const i = ch.notes.findIndex((n) => n.id === noteId);
    if (i < 0) throw new Error(`note ${noteId} does not exist in channel "${ch.name}"`);
    ch.notes.splice(i, 1);
    save();
    return true;
  }

  function openTasks(channelId, agent) {
    return need(channelId).tasks.filter((t) => t.to === agent && t.status === 'open');
  }

  function summary(channelId) {
    const ch = need(channelId);
    const count = (s) => ch.tasks.filter((t) => t.status === s).length;
    const notes = ch.notes.slice(-5).map((n) => `- ${n.text}`);
    return [
      `Channel "${ch.name}" (${ch.id}). Lead: ${ch.lead}. Members: ${ch.members.join(', ')}.`,
      `Tasks: ${count('open')} open, ${count('blocked')} blocked, ${count('done')} done.`,
      notes.length ? `Notes:\n${notes.join('\n')}` : 'Notes: none.',
    ].join('\n');
  }

  function remove(id) {
    need(id);
    channels.delete(id);
    save();
    return true;
  }

  return {
    create,
    list: () => [...channels.values()],
    get: need,
    remove,
    post,
    assign,
    result,
    reply,
    answer,
    transfer,
    remember,
    forget,
    openTasks,
    summary,
  };
}
