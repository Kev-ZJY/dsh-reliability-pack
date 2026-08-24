import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apply,
  installSafeContinuation,
  type ContinuationRuntimeDiagnostic,
  type SafeContinuationContext,
} from '../src/index.ts';

type FakeSessionEvent = {
  type: string;
  data: Record<string, unknown>;
};

type FakeAbortSignal = Pick<AbortSignal, 'aborted'>;

class FakeInbox {
  readonly nextTurn: readonly unknown[];
  readonly nextStep: readonly unknown[];

  constructor(nextTurn: readonly unknown[] = [], nextStep: readonly unknown[] = []) {
    this.nextTurn = nextTurn;
    this.nextStep = nextStep;
  }
}

class FakeAgent {
  readonly steerCalls: unknown[] = [];
  readonly id: string;
  readonly session: {
    id: string;
    header?: { id: string };
    events: readonly FakeSessionEvent[];
  };
  readonly inbox: FakeInbox;

  constructor(
    id: string,
    session: {
      id: string;
      header?: { id: string };
      events: readonly FakeSessionEvent[];
    },
    inbox: FakeInbox,
  ) {
    this.id = id;
    this.session = session;
    this.inbox = inbox;
  }

  steer(message: unknown): void {
    this.steerCalls.push(message);
  }
}

function createContext() {
  let listener: ((payload: { agent: FakeAgent; turn: number; signal: FakeAbortSignal }) => void | Promise<void>) | undefined;
  const cleanups: Array<() => void> = [];

  const ctx: SafeContinuationContext = {
    on(eventName, candidate) {
      assert.equal(eventName, 'agent/turn-stopping');
      listener = candidate as typeof listener;
      return () => {
        listener = undefined;
      };
    },
    effect(factory) {
      const cleanup = factory();
      cleanups.push(cleanup);
      return cleanup;
    },
  };

  return {
    ctx,
    disposeEffects() {
      while (cleanups.length > 0) {
        cleanups.pop()?.();
      }
    },
    async emit(payload: { agent: FakeAgent; turn: number; signal?: FakeAbortSignal }) {
      if (!listener) return;
      await listener({
        ...payload,
        signal: payload.signal ?? { aborted: false },
      });
    },
  };
}

function createAgent(options: {
  sessionId?: string;
  turn?: number;
  finishKind?: string;
  extraEvents?: FakeSessionEvent[];
  nextTurn?: readonly unknown[];
  nextStep?: readonly unknown[];
} = {}): FakeAgent {
  const turn = options.turn ?? 1;
  const finishKind = options.finishKind ?? 'max-tokens';
  const sessionId = options.sessionId ?? 'session-1';

  return new FakeAgent(
    sessionId,
    {
      id: sessionId,
      header: { id: sessionId },
      events: [
        { type: 'turn/end', data: { turn, reason: { kind: finishKind } } },
        ...(options.extraEvents ?? []),
      ],
    },
    new FakeInbox(options.nextTurn, options.nextStep),
  );
}

test('does not steer when safe continuation is disabled', async () => {
  const { ctx, emit } = createContext();
  const diagnostics: ContinuationRuntimeDiagnostic[] = [];
  const agent = createAgent();

  installSafeContinuation(ctx, {
    enabled: false,
    prompt: 'Continue safely.',
    onDiagnostic(diagnostic) {
      diagnostics.push(diagnostic);
    },
  });

  await emit({ agent, turn: 1 });

  assert.equal(agent.steerCalls.length, 0);
  assert.deepEqual(
    diagnostics.map(({ reason, sessionId, turnKey, attempt }) => ({
      reason,
      sessionId,
      turnKey,
      attempt,
    })),
    [{ reason: 'disabled', sessionId: 'session-1', turnKey: 'session-1:1', attempt: 0 }],
  );
});

test('steers exactly once with a plugin user message when continuation is allowed', async () => {
  const { ctx, emit } = createContext();
  const diagnostics: ContinuationRuntimeDiagnostic[] = [];
  const agent = createAgent();

  installSafeContinuation(ctx, {
    enabled: true,
    prompt: 'Continue safely.',
    maxPerTurn: 1,
    maxPerSession: 2,
    onDiagnostic(diagnostic) {
      diagnostics.push(diagnostic);
    },
  });

  await emit({ agent, turn: 1 });

  assert.equal(agent.steerCalls.length, 1);
  assert.deepEqual(agent.steerCalls[0], {
    role: 'user',
    content: [{ type: 'text', text: 'Continue safely.' }],
    source: { kind: 'plugin', plugin: 'dsh-safe-continuation' },
    id: agent.steerCalls[0] && (agent.steerCalls[0] as { id?: string }).id,
  });
  assert.equal(typeof (agent.steerCalls[0] as { id: unknown }).id, 'string');
  assert.deepEqual(
    diagnostics.map(({ reason, attempt }) => ({ reason, attempt })),
    [{ reason: 'continue', attempt: 1 }],
  );
  assert.equal('prompt' in diagnostics[0], false);
});

test('dedupes duplicate turn-stopping delivery for the same session turn', async () => {
  const { ctx, emit } = createContext();
  const agent = createAgent();

  installSafeContinuation(ctx, {
    enabled: true,
    prompt: 'Continue safely.',
  });

  await emit({ agent, turn: 1 });
  await emit({ agent, turn: 1 });

  assert.equal(agent.steerCalls.length, 1);
});

test('enforces the per-session continuation budget across turns', async () => {
  const { ctx, emit } = createContext();
  const diagnostics: ContinuationRuntimeDiagnostic[] = [];
  const agent = createAgent();

  installSafeContinuation(ctx, {
    enabled: true,
    prompt: 'Continue safely.',
    maxPerSession: 1,
    maxPerTurn: 1,
    onDiagnostic(diagnostic) {
      diagnostics.push(diagnostic);
    },
  });

  await emit({ agent, turn: 1 });
  await emit({ agent: createAgent({ sessionId: 'session-1', turn: 2 }), turn: 2 });

  assert.equal(agent.steerCalls.length, 1);
  assert.equal(diagnostics.at(-1)?.reason, 'per-session-budget-exhausted');
});

test('skips continuation when tool activity, queued input, or approval is pending', async () => {
  const toolAgent = createAgent({
    extraEvents: [{ type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'shell', arguments: '{}' } }],
  });
  const queueAgent = createAgent({ nextTurn: [{}] });
  const approvalAgent = createAgent({
    extraEvents: [
      { type: 'approval/asked', data: { id: 'approval-1', toolName: 'shell' } },
    ],
  });

  for (const agent of [toolAgent, queueAgent, approvalAgent]) {
    const { ctx, emit } = createContext();
    installSafeContinuation(ctx, {
      enabled: true,
      prompt: 'Continue safely.',
    });
    await emit({ agent, turn: 1 });
    assert.equal(agent.steerCalls.length, 0);
  }
});

test('skips continuation when the signal is already aborted and after disposal', async () => {
  const { ctx, emit } = createContext();
  const abortedAgent = createAgent();
  const disposedAgent = createAgent({ sessionId: 'session-2' });

  const dispose = installSafeContinuation(ctx, {
    enabled: true,
    prompt: 'Continue safely.',
  });

  await emit({ agent: abortedAgent, turn: 1, signal: { aborted: true } });
  dispose();
  await emit({ agent: disposedAgent, turn: 1 });

  assert.equal(abortedAgent.steerCalls.length, 0);
  assert.equal(disposedAgent.steerCalls.length, 0);
});

test('apply installs the turn-stopping hook through ctx.effect and steers on max-tokens', async () => {
  const { ctx, emit } = createContext();
  const agent = createAgent();

  apply(ctx, {
    enabled: true,
    prompt: 'Continue safely.',
  });

  await emit({ agent, turn: 1 });

  assert.equal(agent.steerCalls.length, 1);
});

test('apply cleanup disposes the installed turn-stopping hook', async () => {
  const { ctx, emit, disposeEffects } = createContext();
  const agent = createAgent();

  apply(ctx, {
    enabled: true,
    prompt: 'Continue safely.',
  });
  disposeEffects();

  await emit({ agent, turn: 1 });

  assert.equal(agent.steerCalls.length, 0);
});
