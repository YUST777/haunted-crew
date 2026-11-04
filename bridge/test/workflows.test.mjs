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
