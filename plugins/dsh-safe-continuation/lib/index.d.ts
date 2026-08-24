//#region src/config.d.ts
interface ContinuationConfig {
  enabled: boolean;
  maxPerTurn: number;
  maxPerSession: number;
  prompt: string;
  skipWhenToolsPresent: boolean;
  skipWhenApprovalPending: boolean;
}
interface ContinuationConfigInput {
  enabled?: boolean;
  maxPerTurn?: number;
  maxPerSession?: number;
  prompt?: string;
  skipWhenToolsPresent?: boolean;
  skipWhenApprovalPending?: boolean;
}
declare const DEFAULT_CONTINUATION_CONFIG: ContinuationConfig;
declare function normalizeContinuationConfig(input?: ContinuationConfigInput): ContinuationConfig;
//#endregion
//#region src/guards.d.ts
interface ContinuationObservation {
  finishKind: string;
  hasToolActivity: boolean;
  approvalPending: boolean;
  queuedInput: boolean;
  aborted: boolean;
  turnKey: string;
  turnCount: number;
  sessionCount: number;
}
interface ContinuationDecision {
  continue: boolean;
  reason: string;
}
declare function decideContinuation(config: ContinuationConfig, observation: ContinuationObservation): ContinuationDecision;
//#endregion
//#region src/continuation.d.ts
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
interface TurnStoppingPayload {
  readonly agent: AgentLike;
  readonly turn: number;
  readonly signal: AbortSignal | Pick<AbortSignal, 'aborted'>;
}
interface ContinuationRuntimeDiagnostic {
  readonly sessionId: string;
  readonly turnKey: string;
  readonly step: 'skip' | 'steer';
  readonly reason: ContinuationDecision['reason'];
  readonly attempt: number;
}
interface SafeContinuationRuntimeOptions extends ContinuationConfigInput {
  readonly onDiagnostic?: (diagnostic: ContinuationRuntimeDiagnostic) => void;
}
interface SafeContinuationContext {
  on?(eventName: 'agent/turn-stopping', listener: (payload: TurnStoppingPayload) => void | Promise<void>): unknown;
  effect?(factory: () => Disposable, label?: string): unknown;
}
declare function installSafeContinuation(ctx: SafeContinuationContext, options?: SafeContinuationRuntimeOptions): Disposable;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-safe-continuation";
interface SafeContinuationConfig extends SafeContinuationRuntimeOptions {}
declare function apply(ctx: SafeContinuationContext, config?: SafeContinuationConfig): void;
//#endregion
export { type ContinuationConfig, type ContinuationConfigInput, type ContinuationDecision, type ContinuationObservation, type ContinuationRuntimeDiagnostic, DEFAULT_CONTINUATION_CONFIG, SafeContinuationConfig, type SafeContinuationContext, type SafeContinuationRuntimeOptions, apply, apply as default, decideContinuation, installSafeContinuation, name, normalizeContinuationConfig };