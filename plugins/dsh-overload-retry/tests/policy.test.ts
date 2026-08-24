import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyOverload,
  normalizeOverloadRetryConfig,
  retryDelay,
  type OverloadClassificationInput,
  type OverloadRetryConfig,
} from '../src/index.ts';

function enabledConfig(overrides: Partial<OverloadRetryConfig> = {}): OverloadRetryConfig {
  return {
    enabled: true,
    providers: ['openai-codex', 'openai-compatible'],
    maxRetries: 3,
    initialDelayMs: 250,
    maxDelayMs: 2_000,
    jitterRatio: 0.2,
    messagePatternIgnoreCase: true,
    messagePatterns: [
      '\\boverloaded\\b',
      '\\bserver_error\\b',
      '\\btemporarily unavailable\\b',
      '\\btry again later\\b',
    ],
    ...overrides,
  };
}

function input(overrides: Partial<OverloadClassificationInput> = {}): OverloadClassificationInput {
  return {
    provider: 'openai-codex',
    code: 'PI_AI_ERROR',
    message: 'Our servers are currently overloaded. Please try again later.',
    ...overrides,
  };
}

test('normalization keeps overload retry opt-in and fills defaults', () => {
  assert.deepEqual(normalizeOverloadRetryConfig({}), {
    enabled: false,
    providers: [],
    maxRetries: 0,
    initialDelayMs: 250,
    maxDelayMs: 4_000,
    jitterRatio: 0.2,
    messagePatternIgnoreCase: true,
    messagePatterns: [
      '\\boverloaded\\b',
      '\\bserver_error\\b',
      '\\btemporarily unavailable\\b',
      '\\btry again later\\b',
    ],
  });
});

test('classifies only allow-listed provider PI_AI_ERROR overload wording as retryable', () => {
  assert.deepEqual(classifyOverload(enabledConfig(), input()), {
    matched: true,
    reason: 'matched-message-pattern',
  });
});

test('rejects provider mismatches and non PI_AI_ERROR codes', () => {
  assert.deepEqual(classifyOverload(enabledConfig(), input({ provider: 'OpenAI-Codex' })), {
    matched: false,
    reason: 'provider-not-allowed',
  });

  assert.deepEqual(classifyOverload(enabledConfig(), input({ code: 'SERVER' })), {
    matched: false,
    reason: 'code-not-pi-ai-error',
  });
});

test('does not retry broad PI_AI_ERROR families that are not transient overloads', () => {
  const config = enabledConfig();

  const nonRetryableMessages = [
    'Authentication failed for this request.',
    'Quota exceeded for this workspace.',
    'This model context window is too large.',
    'Partial stream ended before completion.',
    'client_error: invalid request body',
  ];

  for (const message of nonRetryableMessages) {
    assert.deepEqual(
      classifyOverload(config, input({ message })),
      { matched: false, reason: 'message-not-overload' },
      `message should stay non-retryable: ${message}`,
    );
  }
});

test('matches overload wording with configured case handling only', () => {
  const message = 'SERVER_ERROR: OUR SERVERS ARE CURRENTLY OVERLOADED. TRY AGAIN LATER.';

  assert.deepEqual(classifyOverload(enabledConfig(), input({ message })), {
    matched: true,
    reason: 'matched-message-pattern',
  });

  assert.deepEqual(
    classifyOverload(
      enabledConfig({ messagePatternIgnoreCase: false }),
      input({ message }),
    ),
    { matched: false, reason: 'message-not-overload' },
  );
});

test('computes deterministic capped retry delays with bounded jitter', () => {
  const config = enabledConfig({
    initialDelayMs: 1_000,
    maxDelayMs: 3_000,
    jitterRatio: 0.25,
  });

  assert.equal(retryDelay(config, 0, 0), 750);
  assert.equal(retryDelay(config, 1, 0.5), 2_000);
  assert.equal(retryDelay(config, 3, 1), 3_000);
});
