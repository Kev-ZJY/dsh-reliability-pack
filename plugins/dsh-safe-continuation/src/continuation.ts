import { createUserMessage } from '@deepseek-ai/dsh-llm';

import {
  normalizeContinuationConfig,
  type ContinuationConfig,
  type ContinuationConfigInput,
} from './config.ts';
import {
  decideContinuation,
  type ContinuationDecision,
  type ContinuationObservation,
} from './guards.ts';

type Disposable = () => void;

interface SessionEventLike {
  readonly type: string;
  readonly data: Record<string, unknown>;
}

interface InboxLike {
  readonly nextTurn?: readonly unknown[];
  readonly nextStep?: readonly unknown[];
}

interface SessionLike {
  readonly id: string;
  readonly header?: {
    readonly id: string;
  };
  readonly events?: readonly SessionEventLike[];
}

interface AgentLike {
  readonly id: string;
  readonly session: SessionLike;
  readonly inbox?: InboxLike;
  steer(message: unknown): void;
}

export interface TurnStoppingPayload {
  readonly agent: AgentLike;
  readonly turn: number;
  readonly signal: AbortSignal | Pick<AbortSignal, 'aborted'>;
}

export interface ContinuationRuntimeDiagnostic {
  readonly sessionId: string;
  readonly turnKey: string;
  readonly step: 'skip' | 'steer';
  readonly reason: ContinuationDecision['reason'];
  readonly attempt: number;
}

export interface SafeContinuationRuntimeOptions extends ContinuationConfigInput {
  readonly onDiagnostic?: (diagnostic: ContinuationRuntimeDiagnostic) => void;
}

export interface SafeContinuationContext {
  on?(
    eventName: 'agent/turn-stopping',
    listener: (payload: TurnStoppingPayload) => void | Promise<void>,
  ): unknown;
  effect?(factory: () => Disposable, label?: string): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberField(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value[key] === 'number' ? value[key] : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value[key] === 'string' ? value[key] : undefined;
}

function findTurnFinishKind(events: readonly SessionEventLike[], turn: number): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== 'turn/end') continue;
    if (numberField(event.data, 'turn') !== turn) continue;
    const reason = isRecord(event.data.reason) ? event.data.reason : undefined;
    const kind = reason && typeof reason.kind === 'string' ? reason.kind : undefined;
    if (kind) return kind;
  }
  return 'unknown';
}

function hasToolActivity(events: readonly SessionEventLike[], turn: number): boolean {
  return events.some((event) => {
    if (event.type !== 'tool/call' && event.type !== 'tool/result') return false;
    return numberField(event.data, 'turn') === turn;
  });
}

function hasPendingApproval(events: readonly SessionEventLike[]): boolean {
  const pending = new Set<string>();

  for (const event of events) {
    if (event.type === 'approval/asked') {
      const id = stringField(event.data, 'id');
      if (id) pending.add(id);
      continue;
    }

    if (event.type === 'approval/decided') {
      const id = stringField(event.data, 'id');
      if (id) pending.delete(id);
    }
  }

  return pending.size > 0;
}

function hasQueuedInput(inbox: InboxLike | undefined): boolean {
  return Boolean((inbox?.nextTurn?.length ?? 0) > 0 || (inbox?.nextStep?.length ?? 0) > 0);
}

function toDisposable(value: unknown): Disposable {
  return typeof value === 'function' ? (() => {
    value();
  }) : () => {};
}

function createDiagnostic(
  decision: ContinuationDecision,
  observation: ContinuationObservation,
  sessionId: string,
): ContinuationRuntimeDiagnostic {
  return {
    sessionId,
    turnKey: observation.turnKey,
    step: decision.continue ? 'steer' : 'skip',
    reason: decision.reason,
    attempt: observation.turnCount + (decision.continue ? 1 : 0),
  };
}

function buildObservation(
  config: ContinuationConfig,
  payload: TurnStoppingPayload,
  sessionCount: number,
  turnCount: number,
): ContinuationObservation {
  const events = payload.agent.session.events ?? [];
  const sessionId = payload.agent.session.header?.id ?? payload.agent.session.id ?? payload.agent.id;
  const turnKey = `${sessionId}:${payload.turn}`;

  return {
    finishKind: findTurnFinishKind(events, payload.turn),
    hasToolActivity: hasToolActivity(events, payload.turn),
    approvalPending: config.skipWhenApprovalPending ? hasPendingApproval(events) : false,
    queuedInput: hasQueuedInput(payload.agent.inbox),
    aborted: payload.signal.aborted,
    turnKey,
    turnCount,
    sessionCount,
  };
}

export function installSafeContinuation(
  ctx: SafeContinuationContext,
  options: SafeContinuationRuntimeOptions = {},
): Disposable {
  const config = normalizeContinuationConfig(options);
  const sessionCounts = new Map<string, number>();
  const turnCounts = new Map<string, number>();
  let disposed = false;

  const listener = async (payload: TurnStoppingPayload): Promise<void> => {
    if (disposed) return;

    const sessionId = payload.agent.session.header?.id ?? payload.agent.session.id ?? payload.agent.id;
    const turnKey = `${sessionId}:${payload.turn}`;
    const sessionCount = sessionCounts.get(sessionId) ?? 0;
    const turnCount = turnCounts.get(turnKey) ?? 0;
    const observation = buildObservation(config, payload, sessionCount, turnCount);
    const decision = decideContinuation(config, observation);

    options.onDiagnostic?.(createDiagnostic(decision, observation, sessionId));

    if (!decision.continue || disposed || payload.signal.aborted) {
      return;
    }

    payload.agent.steer(
      createUserMessage({
        content: [{ type: 'text', text: config.prompt }],
        source: { kind: 'plugin', plugin: 'dsh-safe-continuation' },
      }),
    );

    turnCounts.set(turnKey, turnCount + 1);
    sessionCounts.set(sessionId, sessionCount + 1);
  };

  const unsubscribe = toDisposable(ctx.on?.('agent/turn-stopping', listener));

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
  };
}
