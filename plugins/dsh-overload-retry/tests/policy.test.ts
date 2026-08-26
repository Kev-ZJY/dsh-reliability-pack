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
    providers: ['openrouter1'],
    maxRetries: 3,
    initialDelayMs: 250,
    maxDelayMs: 2_000,
    jitterRatio: 0.2,
    messagePatternIgnoreCase: true,
    messagePatterns: [
      '\\btemporarily\\s+overloaded\\b',
      '\\bupstream\\b[\\s\\S]{0,80}\\boverload(?:ed)?\\b',
      '\\bservice\\b[\\s\\S]{0,80}\\b(?:overload(?:ed)?|capacity)\\b',
    ],
    ...overrides,
  };
}

function input(overrides: Partial<OverloadClassificationInput> = {}): OverloadClassificationInput {
  return {
    provider: 'openrouter1',
    code: 'PI_AI_ERROR',
    message: 'The upstream service is temporarily overloaded. Please retry later.',
    ...overrides,
  };
}

test('normalization keeps overload retry opt-in and fills defaults', () => {
  assert.deepEqual(normalizeOverloadRetryConfig({}), {
    enabled: false,
    providers: ['openrouter1'],
    maxRetries: 0,
    initialDelayMs: 250,
    maxDelayMs: 4_000,
    jitterRatio: 0.2,
    messagePatternIgnoreCase: true,
    messagePatterns: [
      '\\btemporarily\\s+overloaded\\b',
      '\\bupstream\\b[\\s\\S]{0,80}\\boverload(?:ed)?\\b',
      '\\bservice\\b[\\s\\S]{0,80}\\b(?:overload(?:ed)?|capacity)\\b',
    ],
  });
});

test('classifies only allow-listed provider PI_AI_ERROR overload wording as retryable', () => {
  assert.deepEqual(classifyOverload(enabledConfig(), input()), {
    matched: true,
    reason: 'matched-message-pattern',
  });
});

test('defaults only allow openrouter1 and explicit allow-lists can widen matching', () => {
  assert.deepEqual(classifyOverload(enabledConfig(), input({ provider: 'OpenAI-Codex' })), {
    matched: false,
    reason: 'provider-not-allowed',
  });

  assert.deepEqual(
    classifyOverload(
      enabledConfig({ providers: ['openrouter1', 'OpenAI-Codex'] }),
      input({ provider: 'OpenAI-Codex' }),
    ),
    { matched: true, reason: 'matched-message-pattern' },
  );
});

test('rejects non PI_AI_ERROR codes', () => {
  assert.deepEqual(classifyOverload(enabledConfig(), input({ code: 'SERVER' })), {
    matched: false,
    reason: 'code-not-pi-ai-error',
  });
});

test('does not retry broad PI_AI_ERROR families that are not transient overloads', () => {
  const config = enabledConfig();

  const nonRetryableMessages: Array<{ message: string; reason: string }> = [
    { message: 'Authentication failed for this request.', reason: 'message-excluded' },
    { message: 'Quota exceeded for this workspace.', reason: 'message-excluded' },
    { message: 'This model context window is too large.', reason: 'message-excluded' },
    { message: 'Partial stream ended before completion.', reason: 'message-not-overload' },
    { message: 'client_error: invalid request body', reason: 'message-excluded' },
  ];

  for (const { message, reason } of nonRetryableMessages) {
    assert.deepEqual(
      classifyOverload(config, input({ message })),
      { matched: false, reason },
      `message should stay non-retryable: ${message}`,
    );
  }
});

test('rejects generic server_error and retry-later wording without explicit overload semantics', () => {
  const config = enabledConfig();
  const nonRetryableMessages = [
    'server_error: please try again later.',
    'temporarily unavailable, try again later.',
    'service degraded, retry later.',
  ];

  for (const message of nonRetryableMessages) {
    assert.deepEqual(
      classifyOverload(config, input({ message })),
      { matched: false, reason: 'message-not-overload' },
      `generic wording should not become retryable: ${message}`,
    );
  }
});

test('hard exclusions win even when overload wording is present', () => {
  const config = enabledConfig();
  const excludedMessages = [
    'Authentication failed while the upstream service is temporarily overloaded.',
    'Unauthorized request: service overload detected.',
    'Forbidden by policy because upstream capacity is exhausted.',
    'Insufficient credits while service overload continues.',
    'Bad request despite temporary overload upstream.',
    'Context window exceeded while the service is overloaded.',
  ];

  for (const message of excludedMessages) {
    assert.deepEqual(
      classifyOverload(config, input({ message })),
      { matched: false, reason: 'message-excluded' },
      `exclusion should take priority: ${message}`,
    );
  }
});

test('matches overload wording with configured case handling only', () => {
  const message = 'UPSTREAM gateway is TEMPORARILY OVERLOADED for this route.';

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

test('fails closed for invalid custom patterns without throwing', () => {
  const invalidConfig = enabledConfig({
    messagePatterns: ['(', '\\btemporarily\\s+overloaded\\b'],
  });

  assert.deepEqual(classifyOverload(invalidConfig, input()), {
    matched: false,
    reason: 'invalid-config',
  });
});

test('allows short custom patterns (user responsibility for pattern quality)', () => {
  // MIN_PATTERN_LENGTH check removed - users are responsible for their regex quality
  assert.deepEqual(
    classifyOverload(
      enabledConfig({ messagePatterns: ['overload', 'ok'] }),
      input({ message: 'The service is overloaded.' }),
    ),
    { matched: true, reason: 'matched-message-pattern' },
  );
});

test('excludes "invalid api key" but not "invalid" in other contexts', () => {
  const config = enabledConfig();

  // Should be excluded - specific invalid patterns
  assert.deepEqual(
    classifyOverload(config, input({ message: 'invalid api key provided' })),
    { matched: false, reason: 'message-excluded' },
  );
  assert.deepEqual(
    classifyOverload(config, input({ message: 'invalid request body' })),
    { matched: false, reason: 'message-excluded' },
  );
  assert.deepEqual(
    classifyOverload(config, input({ message: 'invalid token for authentication' })),
    { matched: false, reason: 'message-excluded' },
  );
  assert.deepEqual(
    classifyOverload(config, input({ message: 'invalid credentials supplied' })),
    { matched: false, reason: 'message-excluded' },
  );

  // Should NOT be excluded - "invalid" in overload context
  assert.deepEqual(
    classifyOverload(config, input({ message: 'The upstream service is temporarily overloaded due to invalid configuration' })),
    { matched: true, reason: 'matched-message-pattern' },
  );
});

test('pattern compilation is cached per config object', () => {
  const config = enabledConfig();
  const input1 = input({ message: 'The upstream service is temporarily overloaded.' });
  const input2 = input({ message: 'The upstream service is temporarily overloaded again.' });

  // First call should compile patterns
  const result1 = classifyOverload(config, input1);
  assert.deepEqual(result1, { matched: true, reason: 'matched-message-pattern' });

  // Second call with same config object should use cache
  const result2 = classifyOverload(config, input2);
  assert.deepEqual(result2, { matched: true, reason: 'matched-message-pattern' });

  // Different config object (even with same values) should compile separately
  const config2 = enabledConfig();
  const result3 = classifyOverload(config2, input1);
  assert.deepEqual(result3, { matched: true, reason: 'matched-message-pattern' });
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
