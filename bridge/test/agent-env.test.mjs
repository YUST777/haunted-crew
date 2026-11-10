import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentEnv } from '../src/agents.mjs';

test('agents get a git sandbox: no network protocols, push URLs blocked, opt-out available', () => {
  const env = agentEnv({ PATH: '/bin' });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.GIT_ALLOW_PROTOCOL, 'haunted-crew-none');
  assert.match(env.GIT_CONFIG_KEY_1, /pushInsteadOf$/);
  assert.equal(env.GIT_CONFIG_COUNT, '7');
  assert.equal(env.GIT_CONFIG_KEY_0, 'protocol.allow');
  const own = agentEnv({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'x' });
  assert.equal(own.GIT_CONFIG_KEY_0, 'user.name'); // the user's entry survives
  assert.equal(own.GIT_CONFIG_KEY_1, 'protocol.allow');
  assert.equal(own.GIT_CONFIG_COUNT, '8');
  assert.equal(agentEnv({ HAUNTED_CREW_ALLOW_GIT_NETWORK: '1' }).GIT_ALLOW_PROTOCOL, undefined);
});
