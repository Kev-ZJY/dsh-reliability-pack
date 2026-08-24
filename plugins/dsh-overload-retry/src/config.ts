export interface OverloadRetryConfig {
  enabled: boolean;
  providers: string[];
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  messagePatternIgnoreCase: boolean;
  messagePatterns: string[];
}

export interface OverloadRetryConfigInput {
  enabled?: boolean;
  providers?: string[];
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  messagePatternIgnoreCase?: boolean;
  messagePatterns?: string[];
}

export const DEFAULT_OVERLOAD_RETRY_CONFIG: OverloadRetryConfig = {
  enabled: false,
  providers: [],
  maxRetries: 0,
  initialDelayMs: 250,
  maxDelayMs: 4_000,
  jitterRatio: 0.2,
  messagePatternIgnoreCase: true,
  messagePatterns: [
    '\\boverloaded\\b',
    '\\bserver_error\\b',
    '\\btemporarily unavailable\\b',
    '\\btry again later\\b',
  ],
};

export function normalizeOverloadRetryConfig(
  input: OverloadRetryConfigInput = {},
): OverloadRetryConfig {
  return {
    enabled: input.enabled ?? DEFAULT_OVERLOAD_RETRY_CONFIG.enabled,
    providers: [...(input.providers ?? DEFAULT_OVERLOAD_RETRY_CONFIG.providers)],
    maxRetries: input.maxRetries ?? DEFAULT_OVERLOAD_RETRY_CONFIG.maxRetries,
    initialDelayMs: input.initialDelayMs ?? DEFAULT_OVERLOAD_RETRY_CONFIG.initialDelayMs,
    maxDelayMs: input.maxDelayMs ?? DEFAULT_OVERLOAD_RETRY_CONFIG.maxDelayMs,
    jitterRatio: input.jitterRatio ?? DEFAULT_OVERLOAD_RETRY_CONFIG.jitterRatio,
    messagePatternIgnoreCase:
      input.messagePatternIgnoreCase ?? DEFAULT_OVERLOAD_RETRY_CONFIG.messagePatternIgnoreCase,
    messagePatterns: [...(input.messagePatterns ?? DEFAULT_OVERLOAD_RETRY_CONFIG.messagePatterns)],
  };
}
