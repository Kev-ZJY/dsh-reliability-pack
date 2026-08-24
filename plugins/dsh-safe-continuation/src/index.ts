import type { SafeContinuationEnvelope } from './runtime-types.ts';
export {
  DEFAULT_CONTINUATION_CONFIG,
  normalizeContinuationConfig,
  type ContinuationConfig,
  type ContinuationConfigInput,
} from './config.ts';
export {
  decideContinuation,
  type ContinuationDecision,
  type ContinuationObservation,
} from './guards.ts';

export interface SafeContinuationConfig {
  enabled?: boolean;
}

export interface SafeContinuationContext {
  on?: (
    eventName: 'session/event',
    listener: (session: SafeContinuationEnvelope['session'], event: SafeContinuationEnvelope['event']) => void,
  ) => unknown;
}

export function load(_ctx: SafeContinuationContext): void {}

export default load;
