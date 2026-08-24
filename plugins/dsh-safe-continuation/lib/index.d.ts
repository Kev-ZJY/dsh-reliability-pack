import { SafeContinuationEnvelope } from "./runtime-types.js";
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
//#region src/index.d.ts
interface SafeContinuationConfig {
  enabled?: boolean;
}
interface SafeContinuationContext {
  on?: (eventName: 'session/event', listener: (session: SafeContinuationEnvelope['session'], event: SafeContinuationEnvelope['event']) => void) => unknown;
}
declare function load(_ctx: SafeContinuationContext): void;
//#endregion
export { type ContinuationConfig, type ContinuationConfigInput, type ContinuationDecision, type ContinuationObservation, DEFAULT_CONTINUATION_CONFIG, SafeContinuationConfig, SafeContinuationContext, decideContinuation, load as default, load, normalizeContinuationConfig };