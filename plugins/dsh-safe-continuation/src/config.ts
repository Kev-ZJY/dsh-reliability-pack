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

export const DEFAULT_CONTINUATION_CONFIG: ContinuationConfig = {
  enabled: false,
  maxPerTurn: 1,
  maxPerSession: 1,
  prompt: '',
  skipWhenToolsPresent: true,
  skipWhenApprovalPending: true,
};

export function normalizeContinuationConfig(input: ContinuationConfigInput = {}): ContinuationConfig {
  return {
    enabled: input.enabled ?? DEFAULT_CONTINUATION_CONFIG.enabled,
    maxPerTurn: input.maxPerTurn ?? DEFAULT_CONTINUATION_CONFIG.maxPerTurn,
    maxPerSession: input.maxPerSession ?? DEFAULT_CONTINUATION_CONFIG.maxPerSession,
    prompt: input.prompt ?? DEFAULT_CONTINUATION_CONFIG.prompt,
    skipWhenToolsPresent: input.skipWhenToolsPresent ?? DEFAULT_CONTINUATION_CONFIG.skipWhenToolsPresent,
    skipWhenApprovalPending:
      input.skipWhenApprovalPending ?? DEFAULT_CONTINUATION_CONFIG.skipWhenApprovalPending,
  };
}
