import z from "@deepseek-ai/schemastery";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
//#region src/path-safety.ts
function normalizeWorkspaceRoot(root) {
	if (typeof root !== "string" || root.trim().length === 0) return void 0;
	return resolve(root);
}
function normalizeContainedPath(root, candidate) {
	if (typeof candidate !== "string" || candidate.length === 0) return void 0;
	const normalized = resolve(root, candidate);
	return isWithinWorkspace(root, normalized) ? normalized : void 0;
}
function isWithinWorkspace(root, candidate) {
	const workspace = resolve(root);
	const normalizedCandidate = resolve(candidate);
	const distance = relative(workspace, normalizedCandidate);
	return distance === "" || !isAbsolute(distance) && distance !== ".." && !distance.startsWith(`..${sep}`);
}
//#endregion
//#region src/search.ts
const DEFAULT_PATH_DIAGNOSTIC_CONFIG = {
	enabled: false,
	readOnly: true,
	maxDepth: 4,
	maxCandidates: 8,
	maxSearchEntries: 2e3,
	suggestOnlyWhenUnique: true
};
const Config = z.object({
	enabled: z.boolean().default(DEFAULT_PATH_DIAGNOSTIC_CONFIG.enabled),
	readOnly: z.const(true).default(true),
	maxDepth: z.natural().default(DEFAULT_PATH_DIAGNOSTIC_CONFIG.maxDepth),
	maxCandidates: z.natural().default(DEFAULT_PATH_DIAGNOSTIC_CONFIG.maxCandidates),
	maxSearchEntries: z.natural().default(DEFAULT_PATH_DIAGNOSTIC_CONFIG.maxSearchEntries),
	suggestOnlyWhenUnique: z.const(true).default(true)
});
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
function isPositiveInteger(value) {
	return Number.isSafeInteger(value) && value > 0;
}
function isNonNegativeInteger(value) {
	return Number.isSafeInteger(value) && value >= 0;
}
function isAbortError(error) {
	if (typeof error !== "object" || error === null) return false;
	const candidate = error;
	return candidate.name === "AbortError" || candidate.code === "ABORT_ERR";
}
function aborted(signal) {
	return signal?.aborted === true;
}
function isSearchFailure(value) {
	return typeof value === "object" && value !== null && "reason" in value;
}
function invalidConfig(config) {
	return config.readOnly !== true || config.suggestOnlyWhenUnique !== true || !isNonNegativeInteger(config.maxDepth) || !isPositiveInteger(config.maxCandidates) || !isPositiveInteger(config.maxSearchEntries) || config.maxSearchEntries > MAX_SAFE_INTEGER;
}
function resultForAdapterError(error, signal) {
	return aborted(signal) || isAbortError(error) ? { reason: "aborted" } : { reason: "search-failed" };
}
async function safeLstat(adapter, path, signal) {
	if (aborted(signal)) return { reason: "aborted" };
	try {
		const metadata = await adapter.lstat(path, signal);
		if (aborted(signal)) return { reason: "aborted" };
		return metadata;
	} catch (error) {
		return resultForAdapterError(error, signal);
	}
}
async function safeListDir(adapter, path, signal) {
	if (aborted(signal)) return { reason: "aborted" };
	try {
		const entries = await adapter.listDir(path, signal);
		if (aborted(signal)) return { reason: "aborted" };
		return entries;
	} catch (error) {
		return resultForAdapterError(error, signal);
	}
}
async function searchUniqueCandidate(root, requestedPath, config, adapter, signal) {
	if (!config.enabled) return { reason: "disabled" };
	if (invalidConfig(config)) return { reason: "invalid-config" };
	if (aborted(signal)) return { reason: "aborted" };
	const workspaceRoot = normalizeWorkspaceRoot(root);
	if (workspaceRoot === void 0) return { reason: "invalid-root" };
	const requested = normalizeContainedPath(workspaceRoot, requestedPath);
	if (requested === void 0) return { reason: "outside-workspace" };
	const requestedName = basename(requested);
	if (requestedName.length === 0 || requestedName === "." || requestedName === "..") return { reason: "invalid-requested-path" };
	const workspaceMetadata = await safeLstat(adapter, workspaceRoot, signal);
	if (isSearchFailure(workspaceMetadata)) return workspaceMetadata;
	if (workspaceMetadata === void 0) return { reason: "workspace-missing" };
	if (workspaceMetadata.type === "symlink") return { reason: "unsafe-workspace" };
	if (workspaceMetadata.type !== "directory") return { reason: "workspace-not-directory" };
	const parentMetadata = await safeLstat(adapter, dirname(requested), signal);
	if (isSearchFailure(parentMetadata)) return parentMetadata;
	if (parentMetadata === void 0) return { reason: "missing-parent" };
	if (parentMetadata.type !== "directory") return { reason: "parent-not-directory" };
	const pending = [{
		path: workspaceRoot,
		depth: 0
	}];
	const visited = /* @__PURE__ */ new Set();
	const candidates = [];
	let entriesSeen = 0;
	while (pending.length > 0) {
		if (aborted(signal)) return { reason: "aborted" };
		const current = pending.shift();
		if (current === void 0 || visited.has(current.path)) continue;
		visited.add(current.path);
		const listed = await safeListDir(adapter, current.path, signal);
		if (isSearchFailure(listed)) return listed;
		if (listed.length > config.maxSearchEntries - entriesSeen) return { reason: "search-entry-cap" };
		entriesSeen += listed.length;
		for (const entry of listed) {
			if (aborted(signal)) return { reason: "aborted" };
			const entryPath = normalizeContainedPath(workspaceRoot, entry.path);
			if (entryPath === void 0 || !isWithinWorkspace(current.path, entryPath)) return { reason: "outside-workspace" };
			const metadata = await safeLstat(adapter, entryPath, signal);
			if (isSearchFailure(metadata)) return metadata;
			if (metadata === void 0 || metadata.type === "symlink" || metadata.type === "other") continue;
			if (metadata.type === "file") {
				if (entry.name !== requestedName) continue;
				candidates.push(entryPath);
				if (candidates.length > config.maxCandidates) return { reason: "candidate-cap" };
				if (candidates.length > 1) return { reason: "multiple-matches" };
				continue;
			}
			if (metadata.type === "directory" && entry.type === "directory" && current.depth < config.maxDepth) pending.push({
				path: entryPath,
				depth: current.depth + 1
			});
		}
	}
	return candidates.length === 1 ? { candidate: candidates[0] } : { reason: "no-match" };
}
//#endregion
//#region src/diagnostics.ts
function isRecord(value) {
	return typeof value === "object" && value !== null;
}
function stringField(value, key) {
	return isRecord(value) && typeof value[key] === "string" ? value[key] : void 0;
}
function requestedPathOf(exec) {
	if (!isRecord(exec.arguments)) return void 0;
	return stringField(exec.arguments, "file_path") ?? stringField(exec.arguments, "path");
}
function errorCodeOf(result) {
	if (result.isError !== true || !result.error) return void 0;
	return stringField(result.error.info, "code") ?? stringField(result.error, "code");
}
function workspaceOf(exec) {
	const cwd = exec.agent?.session?.header?.cwd;
	return typeof cwd === "string" && cwd.length > 0 ? cwd : void 0;
}
function adapterFor(fs, cwd, signal) {
	if (!fs.resolve || !fs.processPath || !fs.lstat || !fs.listDir) return void 0;
	return {
		async lstat(path, childSignal) {
			const metadata = await fs.lstat?.(path, { cwd }, childSignal ?? signal);
			if (!metadata || typeof metadata.type !== "string") return void 0;
			return { type: metadata.type };
		},
		async listDir(path, childSignal) {
			const target = await fs.resolve?.(path, {
				cwd,
				signal: childSignal ?? signal
			});
			if (target === void 0) throw new Error("path could not be resolved");
			const entries = await fs.listDir?.(target, childSignal ?? signal);
			if (!entries) throw new Error("directory could not be listed");
			return entries.flatMap((entry) => {
				const name = entry.name;
				const childTarget = entry.target;
				if (typeof name !== "string" || childTarget === void 0) return [];
				const childPath = fs.processPath?.(childTarget);
				if (typeof childPath !== "string") return [];
				return [{
					name,
					path: childPath,
					type: entry.type === "file" || entry.type === "directory" ? entry.type : "other"
				}];
			});
		}
	};
}
async function diagnoseReadFailure(event, fallbackConfig = DEFAULT_PATH_DIAGNOSTIC_CONFIG) {
	if (event.exec.name !== "read" || errorCodeOf(event.result) !== "FS_NOT_FOUND") return void 0;
	const requestedPath = requestedPathOf(event.exec);
	const cwd = workspaceOf(event.exec);
	const fs = event.fs;
	if (!requestedPath || !cwd || !fs) return void 0;
	const config = event.config ?? fallbackConfig;
	const adapter = adapterFor(fs, cwd, event.exec.signal);
	if (!adapter) return void 0;
	const result = await searchUniqueCandidate(cwd, requestedPath, config, adapter, event.exec.signal);
	if (!("candidate" in result)) return void 0;
	return {
		kind: "dsh-path-diagnostics",
		requestedPath,
		candidate: result.candidate,
		instruction: "re-read the file explicitly before editing or continuing"
	};
}
function toDisposable(value) {
	return typeof value === "function" ? () => value() : () => {};
}
function installPathDiagnostics(ctx, options = DEFAULT_PATH_DIAGNOSTIC_CONFIG) {
	return toDisposable(ctx.on?.("tools/post-execute", async (exec, result, next) => {
		if (options.enabled) try {
			const diagnostic = await diagnoseReadFailure({
				exec,
				result,
				fs: ctx.fs,
				config: options
			});
			if (diagnostic) options.onDiagnostic?.(diagnostic);
		} catch {}
		return next();
	}, { prepend: true }));
}
//#endregion
//#region src/index.ts
const name = "dsh-path-diagnostics";
function apply(ctx, config = DEFAULT_PATH_DIAGNOSTIC_CONFIG) {
	if (ctx.effect) ctx.effect(() => installPathDiagnostics(ctx, config), "dsh-path-diagnostics: dispose post-execute observer");
	else installPathDiagnostics(ctx, config);
}
//#endregion
export { Config, DEFAULT_PATH_DIAGNOSTIC_CONFIG, apply, apply as default, diagnoseReadFailure, installPathDiagnostics, isWithinWorkspace, name, normalizeContainedPath, normalizeWorkspaceRoot, searchUniqueCandidate };
