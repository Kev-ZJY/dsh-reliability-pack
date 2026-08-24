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
//#region src/index.ts
const name = "dsh-path-diagnostics";
function apply(_ctx, _config = DEFAULT_PATH_DIAGNOSTIC_CONFIG) {}
//#endregion
export { DEFAULT_PATH_DIAGNOSTIC_CONFIG, apply, apply as default, isWithinWorkspace, name, normalizeContainedPath, normalizeWorkspaceRoot, searchUniqueCandidate };
