//#region src/config.ts
const DEFAULT_OVERLOAD_RETRY_CONFIG = {
	enabled: false,
	providers: [],
	maxRetries: 0,
	initialDelayMs: 250,
	maxDelayMs: 4e3,
	jitterRatio: .2,
	messagePatternIgnoreCase: true,
	messagePatterns: [
		"\\boverloaded\\b",
		"\\bserver_error\\b",
		"\\btemporarily unavailable\\b",
		"\\btry again later\\b"
	]
};
function normalizeOverloadRetryConfig(input = {}) {
	return {
		enabled: input.enabled ?? DEFAULT_OVERLOAD_RETRY_CONFIG.enabled,
		providers: [...input.providers ?? DEFAULT_OVERLOAD_RETRY_CONFIG.providers],
		maxRetries: input.maxRetries ?? DEFAULT_OVERLOAD_RETRY_CONFIG.maxRetries,
		initialDelayMs: input.initialDelayMs ?? DEFAULT_OVERLOAD_RETRY_CONFIG.initialDelayMs,
		maxDelayMs: input.maxDelayMs ?? DEFAULT_OVERLOAD_RETRY_CONFIG.maxDelayMs,
		jitterRatio: input.jitterRatio ?? DEFAULT_OVERLOAD_RETRY_CONFIG.jitterRatio,
		messagePatternIgnoreCase: input.messagePatternIgnoreCase ?? DEFAULT_OVERLOAD_RETRY_CONFIG.messagePatternIgnoreCase,
		messagePatterns: [...input.messagePatterns ?? DEFAULT_OVERLOAD_RETRY_CONFIG.messagePatterns]
	};
}
//#endregion
//#region src/policy.ts
function classifyOverload(config, input) {
	if (!config.enabled) return {
		matched: false,
		reason: "disabled"
	};
	if (!config.providers.includes(input.provider)) return {
		matched: false,
		reason: "provider-not-allowed"
	};
	if (input.code !== "PI_AI_ERROR") return {
		matched: false,
		reason: "code-not-pi-ai-error"
	};
	const flags = config.messagePatternIgnoreCase ? "i" : "";
	for (const pattern of config.messagePatterns) if (new RegExp(pattern, flags).test(input.message)) return {
		matched: true,
		reason: "matched-message-pattern"
	};
	return {
		matched: false,
		reason: "message-not-overload"
	};
}
function retryDelay(config, retryIndex, randomValue) {
	const jitteredDelay = Math.min(config.maxDelayMs, config.initialDelayMs * 2 ** Math.max(0, retryIndex)) * (1 - config.jitterRatio + 2 * config.jitterRatio * randomValue);
	return Math.round(Math.min(config.maxDelayMs, Math.max(0, jitteredDelay)));
}
//#endregion
//#region src/index.ts
const name = "dsh-overload-retry";
//#endregion
export { DEFAULT_OVERLOAD_RETRY_CONFIG, classifyOverload, name, normalizeOverloadRetryConfig, retryDelay };
