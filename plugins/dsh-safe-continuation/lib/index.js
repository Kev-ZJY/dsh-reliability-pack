//#region src/config.ts
const DEFAULT_CONTINUATION_CONFIG = {
	enabled: false,
	maxPerTurn: 1,
	maxPerSession: 1,
	prompt: "",
	skipWhenToolsPresent: true,
	skipWhenApprovalPending: true
};
function normalizeContinuationConfig(input = {}) {
	return {
		enabled: input.enabled ?? DEFAULT_CONTINUATION_CONFIG.enabled,
		maxPerTurn: input.maxPerTurn ?? DEFAULT_CONTINUATION_CONFIG.maxPerTurn,
		maxPerSession: input.maxPerSession ?? DEFAULT_CONTINUATION_CONFIG.maxPerSession,
		prompt: input.prompt ?? DEFAULT_CONTINUATION_CONFIG.prompt,
		skipWhenToolsPresent: input.skipWhenToolsPresent ?? DEFAULT_CONTINUATION_CONFIG.skipWhenToolsPresent,
		skipWhenApprovalPending: input.skipWhenApprovalPending ?? DEFAULT_CONTINUATION_CONFIG.skipWhenApprovalPending
	};
}
//#endregion
//#region src/guards.ts
function invalidLimit(value) {
	return !Number.isFinite(value) || !Number.isInteger(value) || value < 1;
}
function decideContinuation(config, observation) {
	if (!config.enabled) return {
		continue: false,
		reason: "disabled"
	};
	if (invalidLimit(config.maxPerTurn)) return {
		continue: false,
		reason: "invalid-max-per-turn"
	};
	if (invalidLimit(config.maxPerSession)) return {
		continue: false,
		reason: "invalid-max-per-session"
	};
	if (observation.finishKind !== "max-tokens") return {
		continue: false,
		reason: "finish-kind-not-max-tokens"
	};
	if (config.skipWhenToolsPresent && observation.hasToolActivity) return {
		continue: false,
		reason: "tool-activity"
	};
	if (config.skipWhenApprovalPending && observation.approvalPending) return {
		continue: false,
		reason: "approval-pending"
	};
	if (observation.queuedInput) return {
		continue: false,
		reason: "queued-input"
	};
	if (observation.aborted) return {
		continue: false,
		reason: "aborted"
	};
	if (config.maxPerTurn === 1 && observation.turnCount >= 1) return {
		continue: false,
		reason: "duplicate-turn"
	};
	if (observation.turnCount >= config.maxPerTurn) return {
		continue: false,
		reason: "per-turn-budget-exhausted"
	};
	if (observation.sessionCount >= config.maxPerSession) return {
		continue: false,
		reason: "per-session-budget-exhausted"
	};
	return {
		continue: true,
		reason: "continue"
	};
}
//#endregion
//#region src/index.ts
function load(_ctx) {}
//#endregion
export { DEFAULT_CONTINUATION_CONFIG, decideContinuation, load as default, load, normalizeContinuationConfig };
