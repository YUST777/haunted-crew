import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../src/server.mjs';

// Real bridge + real ACP plumbing + HTTP; only the model is scripted.
test('lead template runs end to end over ACP', async () => {
  const tokens = { ingest: 'i'.repeat(43), command: 'c'.repeat(43), view: 'v'.repeat(43) };
  const quiet = { error() {}, warn() {}, log() {} };
  const fake = fileURLToPath(new URL('./fake-team-acp.mjs', import.meta.url));
  const bridge = createBridge({ tokens, log: quiet, agentOptions: { command: process.execPath, args: [fake], cwd: mkdtempSync(join(tmpdir(), 'hc-e2e-')), processes: 1 } });
  const { port } = await bridge.listen(0, '127.0.0.1');
  const call = (path, body, method = 'POST') => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${tokens.command}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  try {
    const run = await (await call('/api/workflows/tpl-lead/run', { task: 'say hello' })).json();
    let r;
    for (let i = 0; i < 150; i++) {
      r = await (await call(`/api/workflows/runs/${run.id}`, undefined, 'GET')).json();
      if (r.status !== 'running') break;
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.equal(r.status, 'done', JSON.stringify(r.steps));
    assert.equal(r.output, 'shipped: coded and reviewed');
    assert.equal(r.steps.code.status, 'done');
    assert.equal(r.steps.review.status, 'done');
    assert.equal(r.steps.test.status, 'done'); // never assigned
    const hist = await (await call('/api/history/search?q=hello', undefined, 'GET')).json();
    assert.ok(hist.results.length > 0);
  } finally {
    await bridge.close();
  }
});
