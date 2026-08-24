import { SafeContinuationEnvelope } from "./runtime-types.mjs";
//#region src/index.d.ts
interface SafeContinuationConfig {
  enabled?: boolean;
}
interface SafeContinuationContext {
  on?: (eventName: 'session/event', listener: (session: SafeContinuationEnvelope['session'], event: SafeContinuationEnvelope['event']) => void) => unknown;
}
declare function load(_ctx: SafeContinuationContext): void;
//#endregion
export { SafeContinuationConfig, SafeContinuationContext, load as default, load };