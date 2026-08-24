//#region src/config.ts
const DEFAULT_OVERLOAD_RETRY_CONFIG = {
	enabled: false,
	providers: ["openrouter1"],
	maxRetries: 0,
	initialDelayMs: 250,
	maxDelayMs: 4e3,
	jitterRatio: .2,
	messagePatternIgnoreCase: true,
	messagePatterns: [
		"\\btemporarily\\s+overloaded\\b",
		"\\bupstream\\b[\\s\\S]{0,80}\\boverload(?:ed)?\\b",
		"\\bservice\\b[\\s\\S]{0,80}\\b(?:overload(?:ed)?|capacity)\\b"
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
	/\btoken\s+limit\b/i
];
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
	if (EXCLUDED_MESSAGE_PATTERNS.some((pattern) => pattern.test(input.message))) return {
		matched: false,
		reason: "message-excluded"
	};
	const compiledPatterns = compilePatterns(config);
	if (compiledPatterns === null) return {
		matched: false,
		reason: "invalid-config"
	};
	for (const pattern of compiledPatterns) if (pattern.test(input.message)) return {
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
function compilePatterns(config) {
	const flags = config.messagePatternIgnoreCase ? "i" : "";
	const compiledPatterns = [];
	for (const pattern of config.messagePatterns) {
		if (pattern.length < MIN_PATTERN_LENGTH) return null;
		try {
			compiledPatterns.push(new RegExp(pattern, flags));
		} catch {
			return null;
		}
	}
	return compiledPatterns;
}
//#endregion
//#region src/index.ts
const name = "dsh-overload-retry";
//#endregion
export { DEFAULT_OVERLOAD_RETRY_CONFIG, classifyOverload, name, normalizeOverloadRetryConfig, retryDelay };
