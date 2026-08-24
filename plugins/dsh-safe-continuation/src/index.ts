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
export {
  installSafeContinuation,
  type ContinuationRuntimeDiagnostic,
  type SafeContinuationContext,
  type SafeContinuationRuntimeOptions,
} from './continuation.ts';
import type { SafeContinuationContext } from './continuation.ts';

export interface SafeContinuationConfig {
  enabled?: boolean;
}

export function load(_ctx: SafeContinuationContext): void {}

export default load;
