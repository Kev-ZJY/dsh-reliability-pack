import type { OverloadRetryConfig } from './config.ts';

export interface OverloadClassificationInput {
  provider: string;
  code: string;
  message: string;
}

export interface OverloadClassification {
  matched: boolean;
  reason: string;
}

export function classifyOverload(
  config: OverloadRetryConfig,
  input: OverloadClassificationInput,
): OverloadClassification {
  if (!config.enabled) {
    return { matched: false, reason: 'disabled' };
  }

  if (!config.providers.includes(input.provider)) {
    return { matched: false, reason: 'provider-not-allowed' };
  }

  if (input.code !== 'PI_AI_ERROR') {
    return { matched: false, reason: 'code-not-pi-ai-error' };
  }

  const flags = config.messagePatternIgnoreCase ? 'i' : '';
  for (const pattern of config.messagePatterns) {
    if (new RegExp(pattern, flags).test(input.message)) {
      return { matched: true, reason: 'matched-message-pattern' };
    }
  }

  return { matched: false, reason: 'message-not-overload' };
}

export function retryDelay(
  config: OverloadRetryConfig,
  retryIndex: number,
  randomValue: number,
): number {
  const baseDelay = Math.min(
    config.maxDelayMs,
    config.initialDelayMs * 2 ** Math.max(0, retryIndex),
  );
  const jitterScale = 1 - config.jitterRatio + 2 * config.jitterRatio * randomValue;
  const jitteredDelay = baseDelay * jitterScale;

  return Math.round(Math.min(config.maxDelayMs, Math.max(0, jitteredDelay)));
}
