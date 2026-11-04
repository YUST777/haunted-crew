import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPairing } from '../src/pairing.mjs';

test('codes expire after 10 minutes', () => {
  let t = 0;
  const p = createPairing({ now: () => t });
  const { code } = p.create();
  assert.match(code, /^HC-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  t = 10 * 60_000 + 1;
  assert.equal(p.redeem(code), false);
});

test('rejects junk', () => {
  const p = createPairing();
  p.create();
  for (const junk of [null, 42, '', 'HC-', 'hc-zzzz-zzzz-zzzz']) assert.equal(p.redeem(junk), false);
});
