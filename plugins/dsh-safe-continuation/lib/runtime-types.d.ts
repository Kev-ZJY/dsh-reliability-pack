//#region src/runtime-types.d.ts
interface SafeContinuationSessionHeader {
  readonly id: string;
  readonly cwd?: string;
  readonly origin?: 'subagent';
  readonly delegationDepth?: number;
  readonly agentPreset?: string;
}
interface SafeContinuationSession {
  readonly id: string;
  readonly header?: SafeContinuationSessionHeader;
}
interface SafeContinuationRequestContext {
  readonly provider: string;
  readonly model: string;
  readonly contextWindow?: number;
}
interface SafeContinuationSessionEvent {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: unknown;
  readonly ignorable?: true;
}
interface SafeContinuationEnvelope {
  readonly session: SafeContinuationSession;
  readonly event: SafeContinuationSessionEvent;
}
declare function isSafeContinuationEnvelope(value: unknown): value is SafeContinuationEnvelope;
declare function isSafeContinuationRequestContext(value: unknown): value is SafeContinuationRequestContext;
//#endregion
export { SafeContinuationEnvelope, SafeContinuationRequestContext, SafeContinuationSession, SafeContinuationSessionEvent, SafeContinuationSessionHeader, isSafeContinuationEnvelope, isSafeContinuationRequestContext };