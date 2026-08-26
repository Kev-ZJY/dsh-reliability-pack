import { apply, type OverloadRetryRuntimeOptions } from './retry-handler.ts';

export {
  DEFAULT_OVERLOAD_RETRY_CONFIG,
  normalizeOverloadRetryConfig,
  Config,
  type OverloadRetryConfig,
  type OverloadRetryConfigInput,
} from './config.ts';

export {
  classifyOverload,
  retryDelay,
  type OverloadClassification,
  type OverloadClassificationInput,
} from './policy.ts';
export {
  apply,
  installOverloadRetry,
  type OverloadRetryDiagnostic,
  type OverloadRetryRequestErrorPayload,
  type OverloadRetryRuntimeContext,
  type OverloadRetryRuntimeOptions,
} from './retry-handler.ts';

export const name = 'dsh-overload-retry';

export interface OverloadRetryPluginConfig extends OverloadRetryRuntimeOptions {}

export default apply;
