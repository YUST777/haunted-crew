import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkflows, cleanWorkflow, parseSkill, TEMPLATES, order } from '../src/workflows.mjs';

const wf = (nodes, edges) => ({ name: 'T', nodes, edges });
const n = (id, type, data = {}) => ({ id, type, x: 0, y: 0, data });

test('templates are valid one-way graphs', () => {
  for (const t of TEMPLATES) assert.equal(order(cleanWorkflow(t)).length, t.nodes.length, t.id);
});

test('loops and bad boxes are rejected', () => {
  assert.throws(() => cleanWorkflow(wf([n('a', 'agent'), n('b', 'agent')], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])), /loop/);
  assert.throws(() => cleanWorkflow(wf([n('a', 'script')], [])), /bad box/);
  assert.equal(cleanWorkflow(wf([n('a', 'agent', { name: 'Evil<script>' })], [])).nodes[0].data.name, 'Evilscript');
});

test('SKILL.md frontmatter fills name and description', () => {
  const s = parseSkill('---\nname: security-check\ndescription: "Finds secrets"\n---\n# Steps\nLook for keys.');
  assert.deepEqual(s, { name: 'security-check', description: 'Finds secrets', instructions: '# Steps\nLook for keys.' });
});

test('run: parallel branches, results flow forward, custom agent instructions included', async () => {
  const prompts = [];
  let active = 0, peak = 0;
  const agents = {
    create: async (name, model) => ({ session: `s-${name}`, name, model: model ?? 'claude-haiku-5.5' }),
    run: async (session, text) => {
      prompts.push({ session, text });
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      return `${session} done`;
    },
  };
  const w = createWorkflows({ root: mkdtempSync(join(tmpdir(), 'hc-wf-')), agents, log: { warn() {} } });
  const custom = w.saveAgent({ name: 'Sec', source: 'skill', instructions: '---\nname: Sec\n---\nCheck for secrets.' });
  const saved = w.saveWorkflow(wf(
    [n('s', 'start', { task: 'ship it' }), n('a', 'agent', { name: 'A' }), n('b', 'agent', { name: 'B', agentId: custom.id }), n('c', 'agent', { name: 'C' }), n('e', 'end')],
    [{ from: 's', to: 'a' }, { from: 's', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c' }, { from: 'c', to: 'e' }],
  ));
  const run = w.run(saved.id);
  let r;
  for (let i = 0; i < 100 && (r = w.getRun(run.id)).status === 'running'; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(r.status, 'done');
  assert.equal(peak, 2); // A and B at the same time
  const c = prompts.find((p) => p.session === 's-C').text;
  assert.match(c, /ship it/);
  assert.match(c, /## A\ns-A done/);
  assert.match(c, /## B\ns-B done/);
  assert.match(prompts.find((p) => p.session === 's-B').text, /Check for secrets\./);
  assert.equal(r.output, 's-C done');
  assert.equal(createWorkflows({ root: w ? undefined : undefined, agents }).list().workflows.length, 0);
});

test('lead: assigns teammates, reads results, finishes with done', async () => {
  const leadReplies = [
    'Plan.\n```json\n{"assign":[{"to":"Coder","task":"write x"},{"to":"nobody","task":"?"}]}\n```',
    'bad reply with no json',
    'Ok.\n```json\n{"assign":[{"to":"coder","task":"fix x"}]}\n```',
    '```json\n{"done":"shipped"}\n```',
  ];
  const prompts = [];
  const agents = {
    create: async (name) => ({ session: `s-${name}`, name, model: 'm' }),
    run: async (session, text) => {
      prompts.push({ session, text });
      return session === 's-Lead' ? leadReplies.shift() : `${session} result`;
    },
  };
  const w = createWorkflows({ root: mkdtempSync(join(tmpdir(), 'hc-wf-')), agents, log: { warn() {} } });
  const saved = w.saveWorkflow(wf(
    [n('s', 'start', { task: 'do it' }), n('l', 'agent', { name: 'Lead', lead: true }), n('c', 'agent', { name: 'Coder' }), n('t', 'agent', { name: 'Tester' }), n('e', 'end')],
    [{ from: 's', to: 'l' }, { from: 'l', to: 'c' }, { from: 'l', to: 't' }, { from: 'l', to: 'e' }],
  ));
  const run = w.run(saved.id);
  let r;
  for (let i = 0; i < 100 && (r = w.getRun(run.id)).status === 'running'; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(r.status, 'done');
  assert.equal(r.output, 'shipped');
  assert.equal(prompts.filter((p) => p.session === 's-Coder').length, 2); // same ghost reused
  assert.equal(prompts.filter((p) => p.session === 's-Tester').length, 0); // never assigned
  const second = prompts.filter((p) => p.session === 's-Lead')[1].text;
  assert.match(second, /## Coder\ns-Coder result/);
  assert.match(second, /## nobody\nNo such teammate/);
  assert.equal(r.steps.c.status, 'done');
  assert.equal(r.steps.t.status, 'done');
});

test('teammate asks a teammate; recipient cannot chain', async () => {
  const prompts = [];
  const lead = ['```json\n{"assign":[{"to":"Coder","task":"build"}]}\n```', '```json\n{"done":"ok"}\n```'];
  const coder = ['need audit\n```json\n{"ask":[{"to":"Auditor","text":"audit auth.ts"},{"to":"ghost","text":"x"}]}\n```', 'Status: done\nResult: fixed\nEvidence: none'];
  const agents = {
    create: async (name) => ({ session: `s-${name}`, name, model: 'm' }),
    run: async (session, text) => {
      prompts.push({ session, text });
      if (session === 's-Lead') return lead.shift();
      if (session === 's-Coder') return coder.shift();
      return '```json\n{"ask":[{"to":"Coder","text":"loop"}]}\n```Status: done'; // asks are ignored for a recipient
    },
  };
  const w = createWorkflows({ root: mkdtempSync(join(tmpdir(), 'hc-wf-')), agents, log: { warn() {} } });
  const saved = w.saveWorkflow(wf(
    [n('s', 'start', { task: 't' }), n('l', 'agent', { name: 'Lead', lead: true }), n('c', 'agent', { name: 'Coder' }), n('a', 'agent', { name: 'Auditor' }), n('e', 'end')],
    [{ from: 's', to: 'l' }, { from: 'l', to: 'c' }, { from: 'l', to: 'a' }, { from: 'l', to: 'e' }],
  ));
  const run = w.run(saved.id);
  let r;
  for (let i = 0; i < 100 && (r = w.getRun(run.id)).status === 'running'; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(r.status, 'done');
  const aud = prompts.filter((p) => p.session === 's-Auditor');
  assert.equal(aud.length, 1);
  assert.match(aud[0].text, /Message from teammate Coder\.[\s\S]*audit auth\.ts/);
  assert.equal(prompts.filter((p) => p.session === 's-Coder').length, 2); // not re-asked by Auditor
  assert.match(prompts.filter((p) => p.session === 's-Coder')[1].text, /Status: done[\s\S]*No such teammate/);
});

test('teammate uses shared database and memory', async () => {
  const prompts = [];
  const lead = ['```json\n{"assign":[{"to":"Scraper","task":"store leads"},{"to":"Emailer","task":"drop it"}]}\n```', '```json\n{"done":"ok"}\n```'];
  const scraper = ['```json\n{"data":{"op":"execute","sql":"CREATE TABLE leads(email TEXT)"}}\n```', 'Status: done\nREMEMBER: [leads] table leads exists'];
  const emailer = ['```json\n{"data":{"op":"execute","sql":"DROP TABLE leads"}}\n```', 'blocked'];
  const agents = {
    create: async (name) => ({ session: `s-${name}`, name, model: 'm' }),
    run: async (session, text) => {
      prompts.push({ session, text });
      return { 's-Lead': lead, 's-Scraper': scraper, 's-Emailer': emailer }[session].shift();
    },
  };
  const w = createWorkflows({ agents, log: { warn() {} } });
  const saved = w.saveWorkflow(wf(
    [n('s', 'start', { task: 't' }), n('l', 'agent', { name: 'Lead', lead: true }), n('a', 'agent', { name: 'Scraper' }), n('b', 'agent', { name: 'Emailer' }), n('e', 'end')],
    [{ from: 's', to: 'l' }, { from: 'l', to: 'a' }, { from: 'l', to: 'b' }, { from: 'l', to: 'e' }],
  ));
  const run = w.run(saved.id);
  let r;
  for (let i = 0; i < 100 && (r = w.getRun(run.id)).status === 'running'; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(r.status, 'done');
  const emailerSecond = prompts.filter((p) => p.session === 's-Emailer')[1].text;
  assert.match(emailerSecond, /owned by Scraper/);
});

test('teammate asks the human and gets the answer', async () => {
  const prompts = [];
  const lead = ['```json\n{"assign":[{"to":"Coder","task":"x"}]}\n```', '```json\n{"done":"ok"}\n```'];
  const coder = ['```json\n{"ask_user":{"question":"Use tabs?","options":["tabs","spaces"]}}\n```', 'Status: done'];
  const agents = {
    create: async (name) => ({ session: `s-${name}`, name, model: 'm' }),
    askUser: async (session, q, options) => { assert.equal(session, 's-Coder'); assert.deepEqual(options, ['tabs', 'spaces']); return 'spaces'; },
    run: async (session, text) => { prompts.push({ session, text }); return { 's-Lead': lead, 's-Coder': coder }[session].shift(); },
  };
  const w = createWorkflows({ agents, log: { warn() {} } });
  const saved = w.saveWorkflow(wf(
    [n('s', 'start', { task: 't' }), n('l', 'agent', { name: 'Lead', lead: true }), n('c', 'agent', { name: 'Coder' }), n('e', 'end')],
    [{ from: 's', to: 'l' }, { from: 'l', to: 'c' }, { from: 'l', to: 'e' }],
  ));
  const run = w.run(saved.id);
  let r;
  for (let i = 0; i < 100 && (r = w.getRun(run.id)).status === 'running'; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(r.status, 'done');
  assert.match(prompts.filter((p) => p.session === 's-Coder')[1].text, /the user answered\nspaces/);
});

test('teammate tools: list_agents, forget_memory; runs survive a restart as interrupted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hc-wf-'));
  const lead = ['```json\n{"assign":[{"to":"Dev","task":"x"}]}\n```', '```json\n{"done":"ok"}\n```'];
  const dev = ['```json\n{"tool":"list_agents"}\n```', 'Status: done'];
  const prompts = [];
  const agents = {
    create: async (name) => ({ session: `s-${name}`, name, model: 'm' }),
    run: async (session, text) => { prompts.push({ session, text }); return { 's-Lead': lead, 's-Dev': dev }[session].shift(); },
  };
  const w = createWorkflows({ root: dir, agents, log: { warn() {} } });
  const saved = w.saveWorkflow(wf(
    [n('s', 'start', { task: 't' }), n('l', 'agent', { name: 'Lead', lead: true }), n('d', 'agent', { name: 'Dev' }), n('e', 'end')],
    [{ from: 's', to: 'l' }, { from: 'l', to: 'd' }, { from: 'l', to: 'e' }],
  ));
  const run = w.run(saved.id);
  let r;
  for (let i = 0; i < 100 && (r = w.getRun(run.id)).status === 'running'; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(r.status, 'done');
  assert.match(prompts.filter((p) => p.session === 's-Dev')[1].text, /## tool list_agents\n\[\{"name":"Dev"/);
  const again = createWorkflows({ root: dir, agents, log: { warn() {} } });
  assert.equal(again.getRun(run.id).status, 'done');
});
