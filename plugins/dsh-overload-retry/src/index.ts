export {
  DEFAULT_OVERLOAD_RETRY_CONFIG,
  normalizeOverloadRetryConfig,
  type OverloadRetryConfig,
  type OverloadRetryConfigInput,
} from './config.ts';

export {
  classifyOverload,
  retryDelay,
  type OverloadClassification,
  type OverloadClassificationInput,
} from './policy.ts';

export const name = 'dsh-overload-retry';
