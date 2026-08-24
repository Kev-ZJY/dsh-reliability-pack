import type { OverloadRetryConfig } from './config.ts';

const MIN_PATTERN_LENGTH = 10;
const EXCLUDED_MESSAGE_PATTERNS = [
  /\bauth(?:entication)?\b/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\bquota\b/i,
  /\bbilling\b/i,
  /\binsufficient\s+credits?\b/i,
  /\binvalid\b/i,
  /\bbad\s+request\b/i,
  /\bcontext\s+window\b/i,
  /\btoo\s+many\s+tokens?\b/i,
  /\btoken\s+limit\b/i,
];

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

  if (EXCLUDED_MESSAGE_PATTERNS.some((pattern) => pattern.test(input.message))) {
    return { matched: false, reason: 'message-excluded' };
  }

  const compiledPatterns = compilePatterns(config);
  if (compiledPatterns === null) {
    return { matched: false, reason: 'invalid-config' };
  }

  for (const pattern of compiledPatterns) {
    if (pattern.test(input.message)) {
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

function compilePatterns(config: OverloadRetryConfig): RegExp[] | null {
  const flags = config.messagePatternIgnoreCase ? 'i' : '';
  const compiledPatterns: RegExp[] = [];

  for (const pattern of config.messagePatterns) {
    if (pattern.length < MIN_PATTERN_LENGTH) {
      return null;
    }

    try {
      compiledPatterns.push(new RegExp(pattern, flags));
    } catch {
      return null;
    }
  }

  return compiledPatterns;
}
