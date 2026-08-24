import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgent, createProfileFixture, loadPublishedBundle } from './fixture.ts';

test('disposable profile fixture still starts when safe continuation stays disabled', async () => {
  const fixture = createProfileFixture();
  const agent = createAgent();
  const bundle = await loadPublishedBundle();

  bundle.apply(fixture.ctx, {
    enabled: false,
    prompt: 'Continue safely.',
  });

  await fixture.emit({ agent, turn: 1 });

  assert.equal(agent.visibleMessages.length, 0);
});

test('disposable profile fixture emits exactly one visible continuation message for a max-tokens stop', async () => {
  const fixture = createProfileFixture();
  const agent = createAgent();
  const bundle = await loadPublishedBundle();

  bundle.apply(fixture.ctx, {
    enabled: true,
    prompt: 'Continue safely.',
    maxPerTurn: 1,
    maxPerSession: 1,
  });

  await fixture.emit({ agent, turn: 1 });
  await fixture.emit({ agent, turn: 1 });

  assert.equal(agent.visibleMessages.length, 1);
  assert.deepEqual(agent.visibleMessages[0], {
    role: 'user',
    content: [{ type: 'text', text: 'Continue safely.' }],
    source: { kind: 'plugin', plugin: 'dsh-safe-continuation' },
    id: agent.visibleMessages[0] && (agent.visibleMessages[0] as { id?: string }).id,
  });
});
