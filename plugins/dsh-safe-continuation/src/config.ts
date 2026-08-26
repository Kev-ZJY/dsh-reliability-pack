import z from '@deepseek-ai/schemastery';

export interface ContinuationConfig {
  enabled: boolean;
  maxPerTurn: number;
  maxPerSession: number;
  prompt: string;
  skipWhenToolsPresent: boolean;
  skipWhenApprovalPending: boolean;
}

export interface ContinuationConfigInput {
  enabled?: boolean;
  maxPerTurn?: number;
  maxPerSession?: number;
  prompt?: string;
  skipWhenToolsPresent?: boolean;
  skipWhenApprovalPending?: boolean;
}

export const BUILTIN_DEFAULT_PROMPT =
  'Continue exactly where you left off and complete the truncated response.';

export const DEFAULT_CONTINUATION_CONFIG: ContinuationConfig = {
  enabled: false,
  maxPerTurn: 1,
  maxPerSession: 1,
  prompt: '',
  skipWhenToolsPresent: true,
  skipWhenApprovalPending: true,
};

export function normalizeContinuationConfig(input: ContinuationConfigInput = {}): ContinuationConfig {
  const enabled = input.enabled ?? DEFAULT_CONTINUATION_CONFIG.enabled;
  const prompt = input.prompt ?? DEFAULT_CONTINUATION_CONFIG.prompt;
  return {
    enabled,
    maxPerTurn: input.maxPerTurn ?? DEFAULT_CONTINUATION_CONFIG.maxPerTurn,
    maxPerSession: input.maxPerSession ?? DEFAULT_CONTINUATION_CONFIG.maxPerSession,
    prompt: enabled && prompt.trim() === '' ? BUILTIN_DEFAULT_PROMPT : prompt,
    skipWhenToolsPresent: input.skipWhenToolsPresent ?? DEFAULT_CONTINUATION_CONFIG.skipWhenToolsPresent,
    skipWhenApprovalPending:
      input.skipWhenApprovalPending ?? DEFAULT_CONTINUATION_CONFIG.skipWhenApprovalPending,
  };
}

export const Config: z<ContinuationConfig> = z.object({
  enabled: z.boolean().default(DEFAULT_CONTINUATION_CONFIG.enabled),
  maxPerTurn: z.natural().default(DEFAULT_CONTINUATION_CONFIG.maxPerTurn),
  maxPerSession: z.natural().default(DEFAULT_CONTINUATION_CONFIG.maxPerSession),
  prompt: z.string().default(''),
  skipWhenToolsPresent: z.boolean().default(DEFAULT_CONTINUATION_CONFIG.skipWhenToolsPresent),
  skipWhenApprovalPending:
    z.boolean().default(DEFAULT_CONTINUATION_CONFIG.skipWhenApprovalPending),
});
