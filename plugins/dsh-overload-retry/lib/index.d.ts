//#region src/config.d.ts
interface OverloadRetryConfig {
  enabled: boolean;
  providers: string[];
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  messagePatternIgnoreCase: boolean;
  messagePatterns: string[];
}
interface OverloadRetryConfigInput {
  enabled?: boolean;
  providers?: string[];
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  messagePatternIgnoreCase?: boolean;
  messagePatterns?: string[];
}
declare const DEFAULT_OVERLOAD_RETRY_CONFIG: OverloadRetryConfig;
declare function normalizeOverloadRetryConfig(input?: OverloadRetryConfigInput): OverloadRetryConfig;
//#endregion
//#region src/policy.d.ts
interface OverloadClassificationInput {
  provider: string;
  code: string;
  message: string;
}
interface OverloadClassification {
  matched: boolean;
  reason: string;
}
declare function classifyOverload(config: OverloadRetryConfig, input: OverloadClassificationInput): OverloadClassification;
declare function retryDelay(config: OverloadRetryConfig, retryIndex: number, randomValue: number): number;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-overload-retry";
//#endregion
export { DEFAULT_OVERLOAD_RETRY_CONFIG, type OverloadClassification, type OverloadClassificationInput, type OverloadRetryConfig, type OverloadRetryConfigInput, classifyOverload, name, normalizeOverloadRetryConfig, retryDelay };