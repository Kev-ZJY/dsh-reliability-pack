import type { OverloadRetryConfig } from './config.ts';

const EXCLUDED_MESSAGE_PATTERNS = [
  /\bauth(?:entication)?\b/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\bquota\b/i,
  /\bbilling\b/i,
  /\binsufficient\s+credits?\b/i,
  /\binvalid\s+(?:api\s+key|request|token|credentials?)\b/i,
  /\bbad\s+request\b/i,
  /\bcontext\s+window\b/i,
  /\btoo\s+many\s+tokens?\b/i,
  /\btoken\s+limit\b/i,
];

const compiledPatternsCache = new WeakMap<OverloadRetryConfig, RegExp[]>();

export interface OverloadClassificationInput {
  provider: string;
  code: string;
  message: string;
}

export type OverloadClassification =
  | {
    matched: true;
    reason: 'matched-message-pattern';
  }
  | {
    matched: false;
    reason:
      | 'disabled'
      | 'provider-not-allowed'
      | 'code-not-pi-ai-error'
      | 'message-excluded'
      | 'invalid-config'
      | 'message-not-overload';
  };

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
  const cached = compiledPatternsCache.get(config);
  if (cached !== undefined) {
    return cached;
  }

  const flags = config.messagePatternIgnoreCase ? 'i' : '';
  const compiledPatterns: RegExp[] = [];

  for (const pattern of config.messagePatterns) {
    try {
      compiledPatterns.push(new RegExp(pattern, flags));
    } catch {
      return null;
    }
  }

  compiledPatternsCache.set(config, compiledPatterns);
  return compiledPatterns;
}
