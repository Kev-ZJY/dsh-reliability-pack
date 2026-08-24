//#region src/config.d.ts
interface OverloadRetryConfig {
  enabled: boolean;
  providers: string[];
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  messagePatternIgnoreCase: boolean;
  messagePatterns: string[];
}
interface OverloadRetryConfigInput {
  enabled?: boolean;
  providers?: string[];
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  messagePatternIgnoreCase?: boolean;
  messagePatterns?: string[];
}
declare const DEFAULT_OVERLOAD_RETRY_CONFIG: OverloadRetryConfig;
declare function normalizeOverloadRetryConfig(input?: OverloadRetryConfigInput): OverloadRetryConfig;
//#endregion
//#region src/retry-handler.d.ts
type Disposable = () => void;
type RequestErrorAction = {
  kind: 'retry';
} | undefined;
interface SessionEventLike {
  readonly type: string;
  readonly data: Record<string, unknown>;
}
interface SessionLike {
  readonly id: string;
  readonly header?: {
    readonly id: string;
  };
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
interface OverloadRetryRequestErrorPayload {
  readonly agent: AgentLike;
  readonly turn: number;
  readonly step: number;
  readonly provider: string;
  readonly failure: FailureLike;
  readonly retryPolicy: unknown;
  readonly signal: AbortSignal;
}
interface OverloadRetryDiagnostic {
  readonly sessionId: string;
  readonly turn: number;
  readonly step: number;
  readonly provider: string;
  readonly reason: 'disabled' | 'provider-not-allowed' | 'code-not-pi-ai-error' | 'message-excluded' | 'invalid-config' | 'message-not-overload' | 'max-retries-exhausted' | 'committed-tool-activity' | 'aborted' | 'disposed' | 'retry';
  readonly retry: number;
  readonly delayMs?: number;
  readonly failure: {
    readonly code: string;
    readonly status?: number;
    readonly providerRetryAfterMs?: number;
  };
}
interface OverloadRetryRuntimeOptions extends OverloadRetryConfigInput {
  readonly onDiagnostic?: (diagnostic: OverloadRetryDiagnostic) => void;
}
interface OverloadRetryRuntimeContext {
  on?(eventName: 'agent/request-error', listener: (payload: OverloadRetryRequestErrorPayload, next: () => Promise<RequestErrorAction>) => Promise<RequestErrorAction>, options?: {
    prepend?: boolean;
  }): unknown;
  effect?(factory: () => Disposable | Promise<void> | (() => Promise<void>), label?: string): unknown;
}
interface RuntimeInternals {
  readonly random?: () => number;
  readonly wait?: (delayMs: number, signal: AbortSignal) => Promise<boolean>;
}
declare function installOverloadRetry(ctx: OverloadRetryRuntimeContext, options?: OverloadRetryRuntimeOptions, internals?: RuntimeInternals): Disposable;
declare function apply(ctx: OverloadRetryRuntimeContext, config?: OverloadRetryRuntimeOptions): void;
//#endregion
//#region src/policy.d.ts
interface OverloadClassificationInput {
  provider: string;
  code: string;
  message: string;
}
interface OverloadClassification {
  matched: boolean;
  reason: string;
}
declare function classifyOverload(config: OverloadRetryConfig, input: OverloadClassificationInput): OverloadClassification;
declare function retryDelay(config: OverloadRetryConfig, retryIndex: number, randomValue: number): number;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-overload-retry";
interface OverloadRetryPluginConfig extends OverloadRetryRuntimeOptions {}
//#endregion
export { DEFAULT_OVERLOAD_RETRY_CONFIG, type OverloadClassification, type OverloadClassificationInput, type OverloadRetryConfig, type OverloadRetryConfigInput, type OverloadRetryDiagnostic, OverloadRetryPluginConfig, type OverloadRetryRequestErrorPayload, type OverloadRetryRuntimeContext, type OverloadRetryRuntimeOptions, apply, apply as default, classifyOverload, installOverloadRetry, name, normalizeOverloadRetryConfig, retryDelay };