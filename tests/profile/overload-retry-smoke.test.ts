import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

type RequestErrorAction = { kind: 'retry' } | undefined;

type SessionEvent = {
  type: string;
  data: Record<string, unknown>;
};

type Agent = {
  id: string;
  session: {
    id: string;
    header: { id: string };
    events: SessionEvent[];
    append(type: string, data: Record<string, unknown>): void;
  };
};

type RequestErrorPayload = {
  agent: Agent;
  turn: number;
  step: number;
  provider: string;
  failure: {
    code: string;
    message: string;
    status?: number;
  };
  retryPolicy: unknown;
  signal: AbortSignal;
};

type RequestErrorListener = (
  payload: RequestErrorPayload,
  next: () => Promise<RequestErrorAction>,
) => Promise<RequestErrorAction>;

type ListenerRegistration = {
  listener: RequestErrorListener;
  dispose: () => void;
};

class FakeCordisRequestErrorWaterfall {
  private readonly listeners: ListenerRegistration[] = [];
  private readonly cleanups: Array<() => void | Promise<void>> = [];

  readonly ctx = {
    on: (
      eventName: 'agent/request-error',
      listener: RequestErrorListener,
      options?: { prepend?: boolean },
    ) => {
      assert.equal(eventName, 'agent/request-error');
      const registration: ListenerRegistration = {
        listener,
        dispose: () => {
          const index = this.listeners.indexOf(registration);
          if (index >= 0) this.listeners.splice(index, 1);
        },
      };
      if (options?.prepend) this.listeners.unshift(registration);
      else this.listeners.push(registration);
      return registration.dispose;
    },
    effect: (factory: () => (() => void | Promise<void>)) => {
      const cleanup = factory();
      this.cleanups.push(cleanup);
      return cleanup;
    },
  };

  addBuiltInLlmRetry(onRequest: () => void): void {
    this.ctx.on('agent/request-error', async (_payload, _next) => {
      onRequest();
      return undefined;
    });
  }

  async emit(payload: RequestErrorPayload): Promise<RequestErrorAction> {
    const dispatch = async (index: number): Promise<RequestErrorAction> => {
      const registration = this.listeners[index];
      if (!registration) return undefined;
      return registration.listener(payload, () => dispatch(index + 1));
    };
    return dispatch(0);
  }

  async dispose(): Promise<void> {
    while (this.cleanups.length > 0) {
      await this.cleanups.pop()?.();
    }
  }
}

function createAgent(): Agent {
  const session: Agent['session'] = {
    id: 'smoke-session',
    header: { id: 'smoke-session' },
    events: [],
    append(type, data) {
      session.events.push({ type, data });
    },
  };
  return { id: 'smoke-agent', session };
}

function createPayload(
  agent: Agent,
  overrides: Partial<RequestErrorPayload> = {},
): RequestErrorPayload {
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

async function loadBundle() {
  return import('../../plugins/dsh-overload-retry/lib/index.js');
}

test('profile patch mounts the bundle and the loader entry is wired before built-in recovery', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../../plugins/dsh-overload-retry/package.json', import.meta.url), 'utf8'),
  ) as { dsh?: { bundle?: { patch?: string } } };
  const patch = await readFile(
    new URL('../../plugins/dsh-overload-retry/cordis.patch.yml', import.meta.url),
    'utf8',
  );

  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.match(patch, /id: overload-retry/);
  assert.match(patch, /name: dsh-overload-retry/);
  assert.match(patch, /maxRetries: 8/);

  const fixture = new FakeCordisRequestErrorWaterfall();
  const bundle = await loadBundle();
  bundle.apply(fixture.ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 1,
    initialDelayMs: 0,
    maxDelayMs: 0,
    jitterRatio: 0,
  });
  let downstreamCalls = 0;
  fixture.addBuiltInLlmRetry(() => {
    downstreamCalls += 1;
  });

  const result = await fixture.emit(createPayload(createAgent()));

  assert.deepEqual(result, { kind: 'retry' });
  assert.equal(downstreamCalls, 0);
  await fixture.dispose();
});

test('non-overload errors delegate to the downstream dsh-llm-retry listener', async () => {
  const fixture = new FakeCordisRequestErrorWaterfall();
  const bundle = await loadBundle();
  bundle.apply(fixture.ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 1,
    initialDelayMs: 0,
    maxDelayMs: 0,
    jitterRatio: 0,
  });
  let downstreamCalls = 0;
  fixture.addBuiltInLlmRetry(() => {
    downstreamCalls += 1;
  });

  const result = await fixture.emit(createPayload(createAgent(), {
    failure: {
      code: 'SERVER',
      message: 'The upstream service is temporarily overloaded.',
    },
  }));

  assert.equal(result, undefined);
  assert.equal(downstreamCalls, 1);
  await fixture.dispose();
});

test('profile disposal cancels an active overload backoff', async () => {
  const fixture = new FakeCordisRequestErrorWaterfall();
  const bundle = await loadBundle();
  bundle.apply(fixture.ctx, {
    enabled: true,
    providers: ['openrouter1'],
    maxRetries: 1,
    initialDelayMs: 60_000,
    maxDelayMs: 60_000,
    jitterRatio: 0,
  });
  let downstreamCalls = 0;
  fixture.addBuiltInLlmRetry(() => {
    downstreamCalls += 1;
  });

  const pending = fixture.emit(createPayload(createAgent()));
  await fixture.dispose();

  assert.equal(await pending, undefined);
  assert.equal(downstreamCalls, 0);
});
