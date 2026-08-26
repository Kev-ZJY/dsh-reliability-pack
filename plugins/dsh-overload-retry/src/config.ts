import z from '@deepseek-ai/schemastery';

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
  providers: ['openrouter1'],
  maxRetries: 0,
  initialDelayMs: 250,
  maxDelayMs: 4_000,
  jitterRatio: 0.2,
  messagePatternIgnoreCase: true,
  messagePatterns: [
    '\\btemporarily\\s+overloaded\\b',
    '\\bupstream\\b[\\s\\S]{0,80}\\boverload(?:ed)?\\b',
    '\\bservice\\b[\\s\\S]{0,80}\\b(?:overload(?:ed)?|capacity)\\b',
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

export const Config: z<OverloadRetryConfig> = z.object({
  enabled: z.boolean().default(DEFAULT_OVERLOAD_RETRY_CONFIG.enabled),
  providers: z.array(z.string()).default(DEFAULT_OVERLOAD_RETRY_CONFIG.providers),
  maxRetries: z.natural().default(DEFAULT_OVERLOAD_RETRY_CONFIG.maxRetries),
  initialDelayMs: z.natural().default(DEFAULT_OVERLOAD_RETRY_CONFIG.initialDelayMs),
  maxDelayMs: z.natural().default(DEFAULT_OVERLOAD_RETRY_CONFIG.maxDelayMs),
  jitterRatio: z.number().min(0).max(1).default(DEFAULT_OVERLOAD_RETRY_CONFIG.jitterRatio),
  messagePatternIgnoreCase:
    z.boolean().default(DEFAULT_OVERLOAD_RETRY_CONFIG.messagePatternIgnoreCase),
  messagePatterns:
    z.array(z.string()).default(DEFAULT_OVERLOAD_RETRY_CONFIG.messagePatterns),
});
