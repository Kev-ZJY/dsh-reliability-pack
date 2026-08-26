export {
  DEFAULT_CONTINUATION_CONFIG,
  normalizeContinuationConfig,
  BUILTIN_DEFAULT_PROMPT,
  Config,
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
import { installSafeContinuation } from './continuation.ts';
import type { SafeContinuationContext, SafeContinuationRuntimeOptions } from './continuation.ts';

export const name = 'dsh-safe-continuation';

export interface SafeContinuationConfig extends SafeContinuationRuntimeOptions {}

export function apply(ctx: SafeContinuationContext, config: SafeContinuationConfig = {}): void {
  ctx.effect?.(
    () => installSafeContinuation(ctx, config),
    'dsh-safe-continuation: dispose',
  );
}

export default apply;
