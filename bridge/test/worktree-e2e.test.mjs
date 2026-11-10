import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../src/server.mjs';
import { createWorktrees } from '../src/worktrees.mjs';

const sh = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd }).toString().trim();

// Real bridge, real ACP plumbing, real git; only the model is scripted. The Coder writes hello.txt.
test('a run works on its own branch and only lands after the merge is approved', async () => {
  const project = mkdtempSync(join(tmpdir(), 'hc-wt-e2e-'));
  sh(project, 'init', '-q', '-b', 'main');
  writeFileSync(join(project, 'README.md'), '# demo\n');
  sh(project, 'add', '-A');
  sh(project, 'commit', '-q', '-m', 'init');
  const tokens = { ingest: 'i'.repeat(43), command: 'c'.repeat(43), view: 'v'.repeat(43) };
  const quiet = { error() {}, warn() {}, log() {} };
  const fake = fileURLToPath(new URL('./fake-team-acp.mjs', import.meta.url));
  const bridge = createBridge({ tokens, log: quiet, worktrees: createWorktrees({ repo: project }), agentOptions: { command: process.execPath, args: [fake], cwd: project, processes: 1 } });
  const { port } = await bridge.listen(0, '127.0.0.1');
  const call = (path, body, method = 'POST', token = tokens.command) => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  try {
    const run = await (await call('/api/workflows/tpl-lead/run', { task: 'say hello' })).json();
    let r;
    for (let i = 0; i < 200; i++) {
      r = await (await call(`/api/workflows/runs/${run.id}`, undefined, 'GET')).json();
      if (r.status !== 'running') break;
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.equal(r.status, 'done', JSON.stringify(r.steps));
    assert.equal(r.merge?.status, 'pending', JSON.stringify({ merge: r.merge, steps: r.steps, error: r.error }));
    assert.deepEqual(r.merge.names, ['hello.txt']);
    assert.equal(existsSync(join(project, 'hello.txt')), false); // not on the user's branch yet

    const list = await (await call('/api/merges', undefined, 'GET', tokens.view)).json();
    assert.equal(list.merges.length, 1);
    const { diff } = await (await call(`/api/merges/${run.id}/diff`, undefined, 'GET', tokens.view)).json();
    assert.match(diff, /\+hi/);
    assert.equal((await call(`/api/merges/${run.id}/answer`, { option: 'Merge' }, 'POST', tokens.view)).status, 403); // watchers cannot approve

    const done = await (await call(`/api/merges/${run.id}/answer`, { option: 'Merge' })).json();
    assert.equal(done.status, 'merged');
    assert.equal(readFileSync(join(project, 'hello.txt'), 'utf8'), 'hi\n');
    assert.equal((await (await call('/api/merges', undefined, 'GET')).json()).merges.length, 0);
  } finally {
    await bridge.close();
  }
});
