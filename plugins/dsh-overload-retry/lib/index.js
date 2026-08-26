import z from "@deepseek-ai/schemastery";
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
const Config = z.object({
	enabled: z.boolean().default(DEFAULT_OVERLOAD_RETRY_CONFIG.enabled),
	providers: z.array(z.string()).default(DEFAULT_OVERLOAD_RETRY_CONFIG.providers),
	maxRetries: z.natural().default(DEFAULT_OVERLOAD_RETRY_CONFIG.maxRetries),
	initialDelayMs: z.natural().default(DEFAULT_OVERLOAD_RETRY_CONFIG.initialDelayMs),
	maxDelayMs: z.natural().default(DEFAULT_OVERLOAD_RETRY_CONFIG.maxDelayMs),
	jitterRatio: z.number().min(0).max(1).default(DEFAULT_OVERLOAD_RETRY_CONFIG.jitterRatio),
	messagePatternIgnoreCase: z.boolean().default(DEFAULT_OVERLOAD_RETRY_CONFIG.messagePatternIgnoreCase),
	messagePatterns: z.array(z.string()).default(DEFAULT_OVERLOAD_RETRY_CONFIG.messagePatterns)
});
//#endregion
//#region src/policy.ts
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
	/\btoken\s+limit\b/i
];
const compiledPatternsCache = /* @__PURE__ */ new WeakMap();
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
	const cached = compiledPatternsCache.get(config);
	if (cached !== void 0) return cached;
	const flags = config.messagePatternIgnoreCase ? "i" : "";
	const compiledPatterns = [];
	for (const pattern of config.messagePatterns) try {
		compiledPatterns.push(new RegExp(pattern, flags));
	} catch {
		return null;
	}
	compiledPatternsCache.set(config, compiledPatterns);
	return compiledPatterns;
}
//#endregion
//#region src/retry-handler.ts
const DIAGNOSTIC_EVENT_TYPE = "dsh-overload-retry/diagnostic";
const RETRY_SCHEDULED_ACTION = "retry-scheduled";
const RETRY_STARTED_ACTION = "retry-started";
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
function defaultWait(delayMs, signal) {
	if (signal.aborted) return Promise.resolve(false);
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve(true);
		}, delayMs);
		function onAbort() {
			clearTimeout(timer);
			resolve(false);
		}
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
function toDisposable(value) {
	return typeof value === "function" ? () => {
		value();
	} : () => {};
}
function sessionIdOf(agent) {
	return agent.session.header?.id ?? agent.session.id ?? agent.id;
}
function attemptKey(sessionId, payload) {
	return `${sessionId}:${payload.turn}:${payload.step}:${payload.provider}`;
}
function countDurableRetries(events, payload) {
	let attempts = 0;
	for (const event of events) {
		if (event.type !== DIAGNOSTIC_EVENT_TYPE) continue;
		if (stringField(event.data, "plugin") !== "dsh-overload-retry") continue;
		if (stringField(event.data, "action") !== "retry-started") continue;
		if (numberField(event.data, "turn") !== payload.turn) continue;
		if (numberField(event.data, "step") !== payload.step) continue;
		if (stringField(event.data, "provider") !== payload.provider) continue;
		attempts += 1;
	}
	return attempts;
}
function hasCommittedToolActivity(events, payload) {
	return events.some((event) => {
		if (event.type !== "tool/call" && event.type !== "tool/result") return false;
		return numberField(event.data, "turn") === payload.turn && numberField(event.data, "step") === payload.step;
	});
}
function diagnosticFor(payload, reason, retry, delayMs) {
	return {
		sessionId: sessionIdOf(payload.agent),
		turn: payload.turn,
		step: payload.step,
		provider: payload.provider,
		reason,
		retry,
		...delayMs === void 0 ? {} : { delayMs },
		failure: {
			code: payload.failure.code,
			...payload.failure.status === void 0 ? {} : { status: payload.failure.status },
			...payload.failure.providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs: payload.failure.providerRetryAfterMs }
		}
	};
}
function appendDurableDiagnostic(agent, payload, retry, action) {
	if (typeof agent.session.append !== "function") return false;
	const event = {
		plugin: "dsh-overload-retry",
		turn: payload.turn,
		step: payload.step,
		provider: payload.provider,
		action,
		retry
	};
	agent.session.append(DIAGNOSTIC_EVENT_TYPE, event);
	return true;
}
function createRuntime(ctx, options = {}, internals = {}) {
	const config = normalizeOverloadRetryConfig(options);
	const random = internals.random ?? Math.random;
	const wait = internals.wait ?? defaultWait;
	const attempts = /* @__PURE__ */ new Map();
	const lifetime = new AbortController();
	const active = /* @__PURE__ */ new Set();
	let disposed = false;
	function track(operation) {
		const tracked = operation.finally(() => {
			active.delete(tracked);
		});
		active.add(tracked);
		return tracked;
	}
	async function listener(payload, next) {
		try {
			if (disposed || lifetime.signal.aborted) {
				options.onDiagnostic?.(diagnosticFor(payload, "disposed", 0));
				return;
			}
			if (payload.signal.aborted) {
				options.onDiagnostic?.(diagnosticFor(payload, "aborted", 0));
				return;
			}
			const events = payload.agent.session.events ?? [];
			if (hasCommittedToolActivity(events, payload)) {
				options.onDiagnostic?.(diagnosticFor(payload, "committed-tool-activity", 0));
				return next();
			}
			const classification = classifyOverload(config, {
				provider: payload.provider,
				code: payload.failure.code,
				message: payload.failure.message
			});
			if (!classification.matched) {
				options.onDiagnostic?.(diagnosticFor(payload, classification.reason, 0));
				return next();
			}
			const key = attemptKey(sessionIdOf(payload.agent), payload);
			const durableAttempts = countDurableRetries(events, payload);
			const previousAttempts = Math.max(durableAttempts, attempts.get(key) ?? 0);
			if (previousAttempts >= config.maxRetries) {
				options.onDiagnostic?.(diagnosticFor(payload, "max-retries-exhausted", previousAttempts));
				return next();
			}
			const retry = previousAttempts + 1;
			const delayMs = retryDelay(config, retry - 1, random());
			appendDurableDiagnostic(payload.agent, payload, retry, RETRY_SCHEDULED_ACTION);
			const fused = AbortSignal.any([payload.signal, lifetime.signal]);
			const diagnostic = diagnosticFor(payload, "retry", retry, delayMs);
			options.onDiagnostic?.(diagnostic);
			if (!await wait(delayMs, fused)) {
				options.onDiagnostic?.(diagnosticFor(payload, "aborted", retry));
				return;
			}
			if (disposed || lifetime.signal.aborted || payload.signal.aborted) {
				options.onDiagnostic?.(diagnosticFor(payload, disposed ? "disposed" : "aborted", retry));
				return;
			}
			appendDurableDiagnostic(payload.agent, payload, retry, RETRY_STARTED_ACTION);
			attempts.set(key, retry);
			return { kind: "retry" };
		} catch (error) {
			options.onDiagnostic?.(diagnosticFor(payload, "listener-error", 0));
			return next();
		}
	}
	const unsubscribe = toDisposable(ctx.on?.("agent/request-error", (payload, next) => {
		if (disposed || lifetime.signal.aborted) return Promise.resolve(void 0);
		return track(listener(payload, next));
	}, { prepend: true }));
	return {
		dispose: () => {
			if (disposed) return;
			disposed = true;
			unsubscribe();
			lifetime.abort(/* @__PURE__ */ new Error("dsh-overload-retry disposed"));
		},
		drain: Promise.resolve().then(async () => {
			await Promise.allSettled([...active]);
		})
	};
}
function installOverloadRetry(ctx, options = {}, internals = {}) {
	return createRuntime(ctx, options, internals).dispose;
}
function apply(ctx, config = {}) {
	ctx.effect?.(() => {
		const runtime = createRuntime(ctx, config);
		return async () => {
			runtime.dispose();
			await runtime.drain;
		};
	}, "dsh-overload-retry: abort and drain active recovery");
}
//#endregion
//#region src/index.ts
const name = "dsh-overload-retry";
var src_default = apply;
//#endregion
export { Config, DEFAULT_OVERLOAD_RETRY_CONFIG, apply, classifyOverload, src_default as default, installOverloadRetry, name, normalizeOverloadRetryConfig, retryDelay };
