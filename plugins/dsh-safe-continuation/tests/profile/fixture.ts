import assert from 'node:assert/strict';

type FakeSessionEvent = {
  type: string;
  data: Record<string, unknown>;
};

type FakeAbortSignal = Pick<AbortSignal, 'aborted'>;

export type VisibleMessage = {
  role: string;
  content: Array<{ type: string; text: string }>;
  source?: {
    kind?: string;
    plugin?: string;
  };
};

export interface SmokeBundle {
  apply(
    ctx: {
      on?(
        eventName: 'agent/turn-stopping',
        listener: (payload: { agent: FakeAgent; turn: number; signal: FakeAbortSignal }) => void | Promise<void>,
      ): unknown;
      effect?(factory: () => (() => void), label?: string): unknown;
    },
    config?: Record<string, unknown>,
  ): void;
}

type TurnStoppingListener = (
  payload: { agent: FakeAgent; turn: number; signal: FakeAbortSignal },
) => void | Promise<void>;

type FixtureContext = {
  on?(eventName: 'agent/turn-stopping', listener: TurnStoppingListener): unknown;
  effect?(factory: () => () => void, label?: string): unknown;
};

class FakeInbox {
  readonly nextTurn: readonly unknown[];
  readonly nextStep: readonly unknown[];

  constructor(nextTurn: readonly unknown[] = [], nextStep: readonly unknown[] = []) {
    this.nextTurn = nextTurn;
    this.nextStep = nextStep;
  }
}

export class FakeAgent {
  readonly visibleMessages: VisibleMessage[] = [];
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
    this.visibleMessages.push(message as VisibleMessage);
  }
}

export function createProfileFixture() {
  let listener: TurnStoppingListener | undefined;
  const cleanups: Array<() => void> = [];

  return {
    ctx: {
      on(eventName: 'agent/turn-stopping', candidate: TurnStoppingListener) {
        assert.equal(eventName, 'agent/turn-stopping');
        listener = candidate;
        return () => {
          listener = undefined;
        };
      },
      effect(factory: () => () => void) {
        const cleanup = factory();
        cleanups.push(cleanup);
        return cleanup;
      },
    } satisfies FixtureContext,
    dispose() {
      while (cleanups.length > 0) {
        cleanups.pop()?.();
      }
    },
    async emit(payload: { agent: FakeAgent; turn: number; signal?: FakeAbortSignal }) {
      assert.ok(listener, 'safe continuation fixture should register a turn-stopping listener');
      await listener({
        ...payload,
        signal: payload.signal ?? { aborted: false },
      });
    },
  };
}

export function createAgent(options: {
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

export async function loadPublishedBundle(): Promise<SmokeBundle> {
  return import('../../lib/index.js');
}
