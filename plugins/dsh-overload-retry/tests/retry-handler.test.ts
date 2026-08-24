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
  assert.equal(agent.session.events.filter((event) => event.type === 'dsh-overload-retry/diagnostic').length, 1);
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
      action: 'retry-scheduled',
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
