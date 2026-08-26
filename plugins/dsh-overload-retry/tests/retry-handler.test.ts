import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apply,
  installOverloadRetry,
  type OverloadRetryDiagnostic,
  type OverloadRetryRequestErrorPayload,
  type OverloadRetryRuntimeContext,
} from '../src/index.ts';

type FakeSessionEvent = {
  type: string;
  data: Record<string, unknown>;
};

type FakeSession = {
  id: string;
  header?: { id: string };
  events: FakeSessionEvent[];
  append?: (type: string, data: Record<string, unknown>) => void;
};

type FakeAgent = {
  id: string;
  session: FakeSession;
};

type Listener = (
  payload: OverloadRetryRequestErrorPayload,
  next: () => Promise<{ kind: 'retry' } | undefined>,
) => Promise<{ kind: 'retry' } | undefined>;

function createContext() {
  let listener: Listener | undefined;
  let prepend = false;
  const cleanups: Array<() => void | Promise<void>> = [];

  const ctx: OverloadRetryRuntimeContext = {
    on(eventName, candidate, options) {
      assert.equal(eventName, 'agent/request-error');
      prepend = options?.prepend === true;
      listener = candidate as Listener;
      return () => {
        listener = undefined;
      };
    },
    effect(factory) {
      const cleanup = factory();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
      return cleanup;
    },
  };

  return {
    ctx,
    get prepend() {
      return prepend;
    },
    async emit(
      payload: OverloadRetryRequestErrorPayload,
      next: () => Promise<{ kind: 'retry' } | undefined> = async () => undefined,
    ) {
      if (!listener) return undefined;
      return listener(payload, next);
    },
    async disposeEffects() {
      while (cleanups.length > 0) {
        await cleanups.pop()?.();
      }
    },
  };
}

function createAgent(events: FakeSessionEvent[] = []): FakeAgent {
  const session: FakeSession = {
    id: 'session-1',
    header: { id: 'session-1' },
    events: [...events],
  };
  session.append = (type, data) => {
    session.events.push({ type, data });
  };

  return {
    id: 'agent-1',
    session,
  };
}

function payload(
  agent: FakeAgent,
  overrides: Partial<OverloadRetryRequestErrorPayload> = {},
): OverloadRetryRequestErrorPayload {
  return {
    agent,
    turn: 1,
    step: 1,
    provider: 'openrouter1',
    failure: {
      code: 'PI_AI_ERROR',
      message: 'The upstream service is temporarily overloaded. Please retry later.',
    },
    retryPolicy: undefined,
    signal: new AbortController().signal,
    ...overrides,
  };
}

test('non-match delegates exactly once and registers as a prepended request-error waterfall', async () => {
  const diagnostics: OverloadRetryDiagnostic[] = [];
  const harness = createContext();
  const agent = createAgent();
  let nextCalls = 0;

  installOverloadRetry(harness.ctx, {
    enabled: true,
    providers: ['allowed-provider'],
    maxRetries: 1,
    onDiagnostic(diagnostic) {
      diagnostics.push(diagnostic);
    },
  });

  const downstream = { kind: 'retry' as const };
  const result = await harness.emit(
    payload(agent, { provider: 'openrouter1' }),
    async () => {
      nextCalls += 1;
      return downstream;
    },
  );

  assert.equal(harness.prepend, true);
  assert.equal(nextCalls, 1);
  assert.deepEqual(result, downstream);
  assert.equal(diagnostics[0]?.reason, 'provider-not-allowed');
});

test('matching overload waits, appends a durable diagnostic, and returns retry without downstream recovery', async () => {
  const diagnostics: OverloadRetryDiagnostic[] = [];
  const { ctx, emit } = createContext();
  const agent = createAgent();
  let nextCalls = 0;

  installOverloadRetry(ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 2,
    initialDelayMs: 1,
    maxDelayMs: 1,
    jitterRatio: 0,
    onDiagnostic(diagnostic) {
      diagnostics.push(diagnostic);
    },
  });

  const result = await emit(
    payload(agent, {
      failure: {
        code: 'PI_AI_ERROR',
        message: 'The upstream service is temporarily overloaded. sk-test-123 prompt=secret full-response={"huge":true}',
        status: 529,
      },
    }),
    async () => {
      nextCalls += 1;
      return undefined;
    },
  );

  assert.deepEqual(result, { kind: 'retry' });
  assert.equal(nextCalls, 0);
  // Two diagnostic events: retry-scheduled (planning) and retry-started (after wait)
  assert.equal(agent.session.events.filter((event) => event.type === 'dsh-overload-retry/diagnostic').length, 2);
  assert.equal(diagnostics.at(-1)?.reason, 'retry');
  const serialized = JSON.stringify(diagnostics.at(-1));
  assert.equal(serialized.includes('sk-test-123'), false);
  assert.equal(serialized.includes('prompt=secret'), false);
  assert.equal(serialized.includes('full-response'), false);
});

test('max retry guard fails closed from prior durable diagnostics', async () => {
  const prior = {
    type: 'dsh-overload-retry/diagnostic',
    data: {
      plugin: 'dsh-overload-retry',
      turn: 1,
      step: 1,
      provider: 'openrouter1',
      action: 'retry-started',
      retry: 1,
    },
  } satisfies FakeSessionEvent;
  const { ctx, emit } = createContext();
  const agent = createAgent([prior]);
  let nextCalls = 0;

  installOverloadRetry(ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 1,
    initialDelayMs: 1,
    maxDelayMs: 1,
    jitterRatio: 0,
  });

  const result = await emit(payload(agent), async () => {
    nextCalls += 1;
    return undefined;
  });

  assert.equal(nextCalls, 1);
  assert.equal(result, undefined);
  assert.equal(agent.session.events.filter((event) => event.type === 'dsh-overload-retry/diagnostic').length, 1);
});

test('committed tool activity does not retry and delegates exactly once', async () => {
  const { ctx, emit } = createContext();
  const agent = createAgent([
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'shell', arguments: '{}' } },
  ]);
  let nextCalls = 0;

  installOverloadRetry(ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 2,
  });

  const result = await emit(payload(agent), async () => {
    nextCalls += 1;
    return undefined;
  });

  assert.equal(result, undefined);
  assert.equal(nextCalls, 1);
});

test('abort and disposal cancel the bounded wait without opening a retry', async () => {
  const { ctx, emit, disposeEffects } = createContext();
  const agent = createAgent();
  const controller = new AbortController();

  const dispose = installOverloadRetry(ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 2,
    initialDelayMs: 25,
    maxDelayMs: 25,
    jitterRatio: 0,
  });

  const aborted = emit(payload(agent, { signal: controller.signal }));
  controller.abort();
  assert.equal(await aborted, undefined);

  const second = emit(payload(createAgent()));
  dispose();
  assert.equal(await second, undefined);

  apply(ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 1,
  });
  await disposeEffects();
});

test('abort during wait does not consume durable retry budget (two-phase persistence)', async () => {
  const diagnostics: OverloadRetryDiagnostic[] = [];
  const { ctx, emit } = createContext();
  const agent = createAgent();
  const controller = new AbortController();

  installOverloadRetry(ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 2,
    initialDelayMs: 50,
    maxDelayMs: 50,
    jitterRatio: 0,
    onDiagnostic(diagnostic) {
      diagnostics.push(diagnostic);
    },
  });

  // First attempt: abort during wait
  const first = emit(payload(agent, { signal: controller.signal }));
  controller.abort();
  assert.equal(await first, undefined);

  // Verify no retry-started event was written (only retry-scheduled)
  const diagEventsAfterAbort = agent.session.events.filter((event) => event.type === 'dsh-overload-retry/diagnostic');
  const retryStartedAfterAbort = diagEventsAfterAbort.filter((e) => e.data.action === 'retry-started');
  const retryScheduledAfterAbort = diagEventsAfterAbort.filter((e) => e.data.action === 'retry-scheduled');
  assert.equal(retryStartedAfterAbort.length, 0, 'retry-started should not be written when aborted during wait');
  assert.equal(retryScheduledAfterAbort.length, 1, 'retry-scheduled should be written for planning');

  // Second attempt with same parameters should still have full budget (durable count = 0)
  const controller2 = new AbortController();
  const second = emit(payload(agent, { signal: controller2.signal }));
  controller2.abort();
  assert.equal(await second, undefined);

  const diagEventsAfterSecond = agent.session.events.filter((event) => event.type === 'dsh-overload-retry/diagnostic');
  const retryStartedAfterSecond = diagEventsAfterSecond.filter((e) => e.data.action === 'retry-started');
  const retryScheduledAfterSecond = diagEventsAfterSecond.filter((e) => e.data.action === 'retry-scheduled');
  assert.equal(retryStartedAfterSecond.length, 0, 'still no retry-started');
  assert.equal(retryScheduledAfterSecond.length, 2, 'second retry-scheduled written');

  // Third attempt succeeds fully - should have retry-started now
  const controller3 = new AbortController();
  const third = emit(payload(agent, { signal: controller3.signal }));
  assert.deepEqual(await third, { kind: 'retry' });

  const diagEventsAfterThird = agent.session.events.filter((event) => event.type === 'dsh-overload-retry/diagnostic');
  const retryStartedAfterThird = diagEventsAfterThird.filter((e) => e.data.action === 'retry-started');
  const retryScheduledAfterThird = diagEventsAfterThird.filter((e) => e.data.action === 'retry-scheduled');
  assert.equal(retryStartedAfterThird.length, 1, 'retry-started written on successful wait');
  assert.equal(retryScheduledAfterThird.length, 3, 'third retry-scheduled written');
});

test('dual-track counting uses max of durable and in-memory attempts', async () => {
  const { ctx, emit } = createContext();
  // Create agent with 1 durable retry event
  const priorDurable = {
    type: 'dsh-overload-retry/diagnostic',
    data: {
      plugin: 'dsh-overload-retry',
      turn: 1,
      step: 1,
      provider: 'openrouter1',
      action: 'retry-started',
      retry: 1,
    },
  } satisfies FakeSessionEvent;
  const agent = createAgent([priorDurable]);
  let nextCalls = 0;

  installOverloadRetry(ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 3,
    initialDelayMs: 1,
    maxDelayMs: 1,
    jitterRatio: 0,
  });

  // In-memory should track 2 more (for total 3), but durable says 1
  // So max(1, 2) = 2, next retry = 3 which equals maxRetries -> should exhaust
  // Actually: attempt 1 (durable=1), attempt 2 (in-memory=1, durable still 1 -> max=1), attempt 3 (in-memory=2, max=2) -> 3rd attempt should be allowed (retry=3)
  // Wait, let's trace: previousAttempts = max(durable, memory)
  // First call: durable=1, memory=0 -> previous=1, retry=2 -> allowed
  // Second call: durable=1, memory=1 (set after first) -> previous=1, retry=2 -> allowed... wait
  // Actually the memory is set per key. Let me check the key.
  // Key includes sessionId, turn, step, provider. Same payload = same key.
  // After first call: memory[key] = 2 (retry number)
  // Second call: durable=1, memory=2 -> max=2, retry=3 -> allowed (maxRetries=3)
  // Third call: durable=1, memory=3 -> max=3, retry=4 -> maxRetries=3 exhausted -> delegate

  const result1 = await emit(payload(agent), async () => { nextCalls++; return undefined; });
  assert.deepEqual(result1, { kind: 'retry' }, 'first retry should succeed (retry=2)');

  const result2 = await emit(payload(agent), async () => { nextCalls++; return undefined; });
  assert.deepEqual(result2, { kind: 'retry' }, 'second retry should succeed (retry=3)');

  const result3 = await emit(payload(agent), async () => { nextCalls++; return undefined; });
  assert.equal(result3, undefined, 'third retry should exhaust and delegate');
  assert.equal(nextCalls, 1, 'next() called once on exhaustion');
});

test('dual-track counting: memory exceeds durable', async () => {
  const { ctx, emit } = createContext();
  // Create agent with 1 durable retry event
  const priorDurable = {
    type: 'dsh-overload-retry/diagnostic',
    data: {
      plugin: 'dsh-overload-retry',
      turn: 1,
      step: 1,
      provider: 'openrouter1',
      action: 'retry-started',
      retry: 1,
    },
  } satisfies FakeSessionEvent;
  const agent = createAgent([priorDurable]);
  let nextCalls = 0;

  installOverloadRetry(ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 2,
    initialDelayMs: 1,
    maxDelayMs: 1,
    jitterRatio: 0,
  });

  // maxRetries=2, durable=1
  // First call: max(1, 0)=1, retry=2 -> allowed (maxRetries=2)
  // After first: memory=2
  // Second call: max(1, 2)=2, retry=3 -> exhausted (maxRetries=2) -> delegate

  const result1 = await emit(payload(agent), async () => { nextCalls++; return undefined; });
  assert.deepEqual(result1, { kind: 'retry' }, 'first retry should succeed (retry=2)');

  const result2 = await emit(payload(agent), async () => { nextCalls++; return undefined; });
  assert.equal(result2, undefined, 'second retry should exhaust (memory=2 > durable=1)');
  assert.equal(nextCalls, 1, 'next() called once on exhaustion');
});

test('listener exception is caught and delegates to next', async () => {
  const diagnostics: OverloadRetryDiagnostic[] = [];
  const { ctx, emit } = createContext();
  const agent = createAgent();
  let nextCalls = 0;

  // Create a runtime with internals that throws during wait
  const throwingWait = async () => {
    throw new Error('wait exploded');
  };

  installOverloadRetry(ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 2,
    initialDelayMs: 1,
    maxDelayMs: 1,
    jitterRatio: 0,
    onDiagnostic(diagnostic) {
      diagnostics.push(diagnostic);
    },
  }, { wait: throwingWait });

  const result = await emit(payload(agent), async () => {
    nextCalls++;
    return { kind: 'retry' };
  });

  // Should delegate to next() instead of crashing
  assert.deepEqual(result, { kind: 'retry' });
  assert.equal(nextCalls, 1, 'next() was called');
  // Should have emitted listener-error diagnostic
  assert.equal(diagnostics.some(d => d.reason === 'listener-error'), true, 'listener-error diagnostic emitted');
});

test('memory accounting works when session.append is unavailable (no durable events)', async () => {
  const { ctx, emit } = createContext();
  // Agent WITHOUT append function - simulates append unavailable
  const agent: FakeAgent = {
    id: 'agent-1',
    session: {
      id: 'session-1',
      header: { id: 'session-1' },
      events: [],
      // No append function!
    },
  };
  let nextCalls = 0;

  installOverloadRetry(ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 2,
    initialDelayMs: 1,
    maxDelayMs: 1,
    jitterRatio: 0,
  });

  // First retry: memory=0, retry=1
  const result1 = await emit(payload(agent), async () => { nextCalls++; return undefined; });
  assert.deepEqual(result1, { kind: 'retry' }, 'first retry should succeed (retry=1)');

  // Second retry: memory=1, retry=2
  const result2 = await emit(payload(agent), async () => { nextCalls++; return undefined; });
  assert.deepEqual(result2, { kind: 'retry' }, 'second retry should succeed (retry=2)');

  // Third retry: memory=2, retry=3 -> exceeds maxRetries=2, should delegate
  const result3 = await emit(payload(agent), async () => { nextCalls++; return undefined; });
  assert.equal(result3, undefined, 'third retry should exhaust and delegate');
  assert.equal(nextCalls, 1, 'next() called once on exhaustion');
});

test('abort during wait does not increment memory counter', async () => {
  const { ctx, emit } = createContext();
  const agent: FakeAgent = {
    id: 'agent-1',
    session: {
      id: 'session-1',
      header: { id: 'session-1' },
      events: [],
      // No append function!
    },
  };
  let nextCalls = 0;
  let abortController: AbortController;

  installOverloadRetry(ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 3,
    initialDelayMs: 50,
    maxDelayMs: 50,
    jitterRatio: 0,
  }, {
    wait: async (delayMs, signal) => {
      if (signal.aborted) return false;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve(true);
        }, delayMs);
        function onAbort() {
          clearTimeout(timer);
          resolve(false);
        }
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  });

  // First attempt - abort during wait
  abortController = new AbortController();
  const first = emit(payload(agent, { signal: abortController.signal }));
  abortController.abort();
  assert.equal(await first, undefined, 'first attempt aborted');

  // Second attempt - abort during wait again
  abortController = new AbortController();
  const second = emit(payload(agent, { signal: abortController.signal }));
  abortController.abort();
  assert.equal(await second, undefined, 'second attempt aborted');

  // Third attempt - should succeed, memory should still be 0 (no retries started)
  const third = emit(payload(agent));
  const result = await third;
  assert.deepEqual(result, { kind: 'retry' }, 'third attempt should succeed with retry=1');
});
