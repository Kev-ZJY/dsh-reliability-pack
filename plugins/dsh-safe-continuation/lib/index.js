import { createUserMessage } from "@deepseek-ai/dsh-llm";
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
//#region src/continuation.ts
function isRecord(value) {
	return typeof value === "object" && value !== null;
}
function numberField(value, key) {
	if (!isRecord(value)) return void 0;
	return typeof value[key] === "number" ? value[key] : void 0;
}
function stringField(value, key) {
	if (!isRecord(value)) return void 0;
	return typeof value[key] === "string" ? value[key] : void 0;
}
function findTurnFinishKind(events, turn) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event.type !== "turn/end") continue;
		if (numberField(event.data, "turn") !== turn) continue;
		const reason = isRecord(event.data.reason) ? event.data.reason : void 0;
		const kind = reason && typeof reason.kind === "string" ? reason.kind : void 0;
		if (kind) return kind;
	}
	return "unknown";
}
function hasToolActivity(events, turn) {
	return events.some((event) => {
		if (event.type !== "tool/call" && event.type !== "tool/result") return false;
		return numberField(event.data, "turn") === turn;
	});
}
function hasPendingApproval(events) {
	const pending = /* @__PURE__ */ new Set();
	for (const event of events) {
		if (event.type === "approval/asked") {
			const id = stringField(event.data, "id");
			if (id) pending.add(id);
			continue;
		}
		if (event.type === "approval/decided") {
			const id = stringField(event.data, "id");
			if (id) pending.delete(id);
		}
	}
	return pending.size > 0;
}
function hasQueuedInput(inbox) {
	return Boolean((inbox?.nextTurn?.length ?? 0) > 0 || (inbox?.nextStep?.length ?? 0) > 0);
}
function toDisposable(value) {
	return typeof value === "function" ? (() => {
		value();
	}) : () => {};
}
function createDiagnostic(decision, observation, sessionId) {
	return {
		sessionId,
		turnKey: observation.turnKey,
		step: decision.continue ? "steer" : "skip",
		reason: decision.reason,
		attempt: observation.turnCount + (decision.continue ? 1 : 0)
	};
}
function buildObservation(config, payload, sessionCount, turnCount) {
	const events = payload.agent.session.events ?? [];
	const turnKey = `${payload.agent.session.header?.id ?? payload.agent.session.id ?? payload.agent.id}:${payload.turn}`;
	return {
		finishKind: findTurnFinishKind(events, payload.turn),
		hasToolActivity: hasToolActivity(events, payload.turn),
		approvalPending: config.skipWhenApprovalPending ? hasPendingApproval(events) : false,
		queuedInput: hasQueuedInput(payload.agent.inbox),
		aborted: payload.signal.aborted,
		turnKey,
		turnCount,
		sessionCount
	};
}
function installSafeContinuation(ctx, options = {}) {
	const config = normalizeContinuationConfig(options);
	const sessionCounts = /* @__PURE__ */ new Map();
	const turnCounts = /* @__PURE__ */ new Map();
	let disposed = false;
	const listener = async (payload) => {
		if (disposed) return;
		const sessionId = payload.agent.session.header?.id ?? payload.agent.session.id ?? payload.agent.id;
		const turnKey = `${sessionId}:${payload.turn}`;
		const sessionCount = sessionCounts.get(sessionId) ?? 0;
		const turnCount = turnCounts.get(turnKey) ?? 0;
		const observation = buildObservation(config, payload, sessionCount, turnCount);
		const decision = decideContinuation(config, observation);
		options.onDiagnostic?.(createDiagnostic(decision, observation, sessionId));
		if (!decision.continue || disposed || payload.signal.aborted) return;
		payload.agent.steer(createUserMessage({
			content: [{
				type: "text",
				text: config.prompt
			}],
			source: {
				kind: "plugin",
				plugin: "dsh-safe-continuation"
			}
		}));
		turnCounts.set(turnKey, turnCount + 1);
		sessionCounts.set(sessionId, sessionCount + 1);
	};
	const unsubscribe = toDisposable(ctx.on?.("agent/turn-stopping", listener));
	return () => {
		if (disposed) return;
		disposed = true;
		unsubscribe();
	};
}
//#endregion
//#region src/index.ts
function load(_ctx) {}
//#endregion
export { DEFAULT_CONTINUATION_CONFIG, decideContinuation, load as default, load, installSafeContinuation, normalizeContinuationConfig };
