import {
  normalizeOverloadRetryConfig,
  type OverloadRetryConfig,
  type OverloadRetryConfigInput,
} from './config.ts';
import {
  classifyOverload,
  retryDelay,
} from './policy.ts';

type Disposable = () => void;
type RequestErrorAction = { kind: 'retry' } | undefined;

interface SessionEventLike {
  readonly type: string;
  readonly data: Record<string, unknown>;
}

interface SessionLike {
  readonly id: string;
  readonly header?: { readonly id: string };
  readonly events?: readonly SessionEventLike[];
  append?: (type: string, data: Record<string, unknown>) => unknown;
}

interface AgentLike {
  readonly id: string;
  readonly session: SessionLike;
}

interface FailureLike {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  readonly providerRetryAfterMs?: number;
  readonly requestId?: string;
}

export interface OverloadRetryRequestErrorPayload {
  readonly agent: AgentLike;
  readonly turn: number;
  readonly step: number;
  readonly provider: string;
  readonly failure: FailureLike;
  readonly retryPolicy: unknown;
  readonly signal: AbortSignal;
}

export interface OverloadRetryDiagnostic {
  readonly sessionId: string;
  readonly turn: number;
  readonly step: number;
  readonly provider: string;
  readonly reason:
    | 'disabled'
    | 'provider-not-allowed'
    | 'code-not-pi-ai-error'
    | 'message-excluded'
    | 'invalid-config'
    | 'message-not-overload'
    | 'max-retries-exhausted'
    | 'committed-tool-activity'
    | 'aborted'
    | 'disposed'
    | 'retry';
  readonly retry: number;
  readonly delayMs?: number;
  readonly failure: {
    readonly code: string;
    readonly status?: number;
    readonly providerRetryAfterMs?: number;
  };
}

export interface OverloadRetryRuntimeOptions extends OverloadRetryConfigInput {
  readonly onDiagnostic?: (diagnostic: OverloadRetryDiagnostic) => void;
}

export interface OverloadRetryRuntimeContext {
  on?(
    eventName: 'agent/request-error',
    listener: (
      payload: OverloadRetryRequestErrorPayload,
      next: () => Promise<RequestErrorAction>,
    ) => Promise<RequestErrorAction>,
    options?: { prepend?: boolean },
  ): unknown;
  effect?(factory: () => Disposable | Promise<void> | (() => Promise<void>), label?: string): unknown;
}

interface RuntimeInternals {
  readonly random?: () => number;
  readonly wait?: (delayMs: number, signal: AbortSignal) => Promise<boolean>;
}

interface RuntimeState {
  readonly dispose: Disposable;
  readonly drain: Promise<void>;
}

interface RetryDiagnosticEventData {
  readonly plugin: 'dsh-overload-retry';
  readonly turn: number;
  readonly step: number;
  readonly provider: string;
  readonly action: 'retry-scheduled';
  readonly retry: number;
}

const DIAGNOSTIC_EVENT_TYPE = 'dsh-overload-retry/diagnostic';

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

function defaultWait(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, delayMs);
    function onAbort(): void {
      clearTimeout(timer);
      resolve(false);
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function toDisposable(value: unknown): Disposable {
  return typeof value === 'function'
    ? () => {
      value();
    }
    : () => {};
}

function sessionIdOf(agent: AgentLike): string {
  return agent.session.header?.id ?? agent.session.id ?? agent.id;
}

function attemptKey(sessionId: string, payload: OverloadRetryRequestErrorPayload): string {
  return `${sessionId}:${payload.turn}:${payload.step}:${payload.provider}`;
}

function countDurableRetries(events: readonly SessionEventLike[], payload: OverloadRetryRequestErrorPayload): number {
  let attempts = 0;
  for (const event of events) {
    if (event.type !== DIAGNOSTIC_EVENT_TYPE) continue;
    if (stringField(event.data, 'plugin') !== 'dsh-overload-retry') continue;
    if (stringField(event.data, 'action') !== 'retry-scheduled') continue;
    if (numberField(event.data, 'turn') !== payload.turn) continue;
    if (numberField(event.data, 'step') !== payload.step) continue;
    if (stringField(event.data, 'provider') !== payload.provider) continue;
    attempts += 1;
  }
  return attempts;
}

function hasCommittedToolActivity(events: readonly SessionEventLike[], payload: OverloadRetryRequestErrorPayload): boolean {
  return events.some((event) => {
    if (event.type !== 'tool/call' && event.type !== 'tool/result') return false;
    return numberField(event.data, 'turn') === payload.turn
      && numberField(event.data, 'step') === payload.step;
  });
}

function diagnosticFor(
  payload: OverloadRetryRequestErrorPayload,
  reason: OverloadRetryDiagnostic['reason'],
  retry: number,
  delayMs?: number,
): OverloadRetryDiagnostic {
  return {
    sessionId: sessionIdOf(payload.agent),
    turn: payload.turn,
    step: payload.step,
    provider: payload.provider,
    reason,
    retry,
    ...(delayMs === undefined ? {} : { delayMs }),
    failure: {
      code: payload.failure.code,
      ...(payload.failure.status === undefined ? {} : { status: payload.failure.status }),
      ...(payload.failure.providerRetryAfterMs === undefined
        ? {}
        : { providerRetryAfterMs: payload.failure.providerRetryAfterMs }),
    },
  };
}

function appendDurableDiagnostic(agent: AgentLike, payload: OverloadRetryRequestErrorPayload, retry: number): boolean {
  if (typeof agent.session.append !== 'function') return false;
  const event: RetryDiagnosticEventData = {
    plugin: 'dsh-overload-retry',
    turn: payload.turn,
    step: payload.step,
    provider: payload.provider,
    action: 'retry-scheduled',
    retry,
  };
  agent.session.append(DIAGNOSTIC_EVENT_TYPE, event);
  return true;
}

function createRuntime(
  ctx: OverloadRetryRuntimeContext,
  options: OverloadRetryRuntimeOptions = {},
  internals: RuntimeInternals = {},
): RuntimeState {
  const config: OverloadRetryConfig = normalizeOverloadRetryConfig(options);
  const random = internals.random ?? Math.random;
  const wait = internals.wait ?? defaultWait;
  const attempts = new Map<string, number>();
  const lifetime = new AbortController();
  const active = new Set<Promise<RequestErrorAction>>();
  let disposed = false;

  function track(operation: Promise<RequestErrorAction>): Promise<RequestErrorAction> {
    const tracked = operation.finally(() => {
      active.delete(tracked);
    });
    active.add(tracked);
    return tracked;
  }

  async function listener(
    payload: OverloadRetryRequestErrorPayload,
    next: () => Promise<RequestErrorAction>,
  ): Promise<RequestErrorAction> {
    if (disposed || lifetime.signal.aborted) {
      options.onDiagnostic?.(diagnosticFor(payload, 'disposed', 0));
      return undefined;
    }

    if (payload.signal.aborted) {
      options.onDiagnostic?.(diagnosticFor(payload, 'aborted', 0));
      return undefined;
    }

    const events = payload.agent.session.events ?? [];
    if (hasCommittedToolActivity(events, payload)) {
      options.onDiagnostic?.(diagnosticFor(payload, 'committed-tool-activity', 0));
      return next();
    }

    const classification = classifyOverload(config, {
      provider: payload.provider,
      code: payload.failure.code,
      message: payload.failure.message,
    });
    if (!classification.matched) {
      options.onDiagnostic?.(diagnosticFor(payload, classification.reason, 0));
      return next();
    }

    const sessionId = sessionIdOf(payload.agent);
    const key = attemptKey(sessionId, payload);
    const durableAttempts = countDurableRetries(events, payload);
    const previousAttempts = durableAttempts > 0 ? durableAttempts : (attempts.get(key) ?? 0);
    if (previousAttempts >= config.maxRetries) {
      options.onDiagnostic?.(diagnosticFor(payload, 'max-retries-exhausted', previousAttempts));
      return next();
    }

    const retry = previousAttempts + 1;
    const delayMs = retryDelay(config, retry - 1, random());
    const persisted = appendDurableDiagnostic(payload.agent, payload, retry);
    if (!persisted) {
      attempts.set(key, retry);
    }

    const fused = AbortSignal.any([payload.signal, lifetime.signal]);
    const diagnostic = diagnosticFor(payload, 'retry', retry, delayMs);
    options.onDiagnostic?.(diagnostic);
    if (!await wait(delayMs, fused)) {
      options.onDiagnostic?.(diagnosticFor(payload, 'aborted', retry));
      return undefined;
    }
    if (disposed || lifetime.signal.aborted || payload.signal.aborted) {
      options.onDiagnostic?.(diagnosticFor(payload, disposed ? 'disposed' : 'aborted', retry));
      return undefined;
    }
    return { kind: 'retry' };
  }

  const unsubscribe = toDisposable(ctx.on?.('agent/request-error', (payload, next) => {
    if (disposed || lifetime.signal.aborted) return Promise.resolve<RequestErrorAction>(undefined);
    return track(listener(payload, next));
  }, { prepend: true }));

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      lifetime.abort(new Error('dsh-overload-retry disposed'));
    },
    drain: Promise.resolve().then(async () => {
      await Promise.allSettled([...active]);
    }),
  };
}

export function installOverloadRetry(
  ctx: OverloadRetryRuntimeContext,
  options: OverloadRetryRuntimeOptions = {},
  internals: RuntimeInternals = {},
): Disposable {
  return createRuntime(ctx, options, internals).dispose;
}

export function apply(
  ctx: OverloadRetryRuntimeContext,
  config: OverloadRetryRuntimeOptions = {},
): void {
  ctx.effect?.(() => {
    const runtime = createRuntime(ctx, config);
    return async () => {
      runtime.dispose();
      await runtime.drain;
    };
  }, 'dsh-overload-retry: abort and drain active recovery');
}
