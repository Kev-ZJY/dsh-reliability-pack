import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
//#region src/hash.ts
function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}
async function sha256File(path) {
	return sha256(await readFile(path));
}
//#endregion
//#region src/inspect-profile.ts
async function readText(path) {
	if (path === void 0) return {
		ok: false,
		code: "missing"
	};
	try {
		return {
			ok: true,
			text: await readFile(path, "utf8")
		};
	} catch (error) {
		return {
			ok: false,
			code: typeof error === "object" && error !== null && "code" in error ? String(error.code) : void 0
		};
	}
}
async function readJson$1(path) {
	const result = await readText(path);
	if (!result.ok) return {
		ok: false,
		code: result.code === "ENOENT" || result.code === "missing" ? "missing" : "unreadable"
	};
	try {
		const value = JSON.parse(result.text);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return {
			ok: false,
			code: "malformed"
		};
		return {
			ok: true,
			value,
			text: result.text
		};
	} catch {
		return {
			ok: false,
			code: "malformed"
		};
	}
}
function check(id, ok, message, path, expected, actual) {
	return {
		id,
		ok,
		message,
		...path === void 0 ? {} : { path },
		...expected === void 0 ? {} : { expected },
		...actual === void 0 ? {} : { actual }
	};
}
function validLockfile(text) {
	const version = /^\s*lockfileVersion:\s*['"]?(\d+(?:\.\d+)?)['"]?\s*$/m.test(text);
	const importers = /^\s*importers:\s*$/m.test(text);
	const unbalanced = (text.match(/\[/g)?.length ?? 0) !== (text.match(/\]/g)?.length ?? 0) || (text.match(/\{/g)?.length ?? 0) !== (text.match(/\}/g)?.length ?? 0);
	return version && importers && !unbalanced;
}
function validWorkspacePolicy(text) {
	return /^\s*packages:\s*$/m.test(text);
}
function validPatch(text) {
	return /^\s*id:\s*\S+/m.test(text) && /^\s*name:\s*\S+/m.test(text);
}
function packageName(value) {
	return typeof value.name === "string" ? value.name : void 0;
}
function packageVersion(value) {
	return typeof value.version === "string" ? value.version : void 0;
}
function resultCode(result) {
	return result.exitCode ?? result.code ?? result.status ?? 1;
}
function packageChecks(input) {
	return input.packageChecks ?? input.packages ?? [];
}
async function inspectPackage(item) {
	const parsed = await readJson$1(item.manifestPath);
	let hash;
	try {
		hash = await sha256File(item.manifestPath);
	} catch {
		hash = void 0;
	}
	if (!parsed.ok) return {
		checks: check(`package:${item.name}`, false, `package manifest is ${parsed.code}`, item.manifestPath),
		hash
	};
	const actualName = packageName(parsed.value);
	const actualVersion = packageVersion(parsed.value);
	const nameOk = actualName === item.name;
	const versionOk = item.expectedVersion === void 0 || actualVersion === item.expectedVersion;
	const hashOk = item.expectedHash === void 0 || hash === item.expectedHash;
	return {
		checks: check(`package:${item.name}`, nameOk && versionOk && hashOk, nameOk && versionOk && hashOk ? "package manifest matches" : "package manifest differs from expectation", item.manifestPath, item.expectedVersion, actualVersion),
		hash
	};
}
async function inspectProfile(input) {
	const profilePath = input.profilePath ?? input.profileRoot ?? "";
	const manifestPath = input.manifestPath ?? input.profileManifestPath;
	const workspacePath = input.workspacePolicyPath ?? input.workspacePath;
	const patchPath = input.cordisPatchPath ?? input.patchPath;
	const checks = [];
	let lockfileHash;
	let dshVersion;
	const pluginManifestHashes = {};
	const manifest = await readJson$1(manifestPath);
	const manifestOk = manifest.ok && packageName(manifest.value) !== void 0;
	checks.push(check("profile-manifest", manifestOk, manifestOk ? "profile manifest is valid" : `profile manifest is ${manifest.ok ? "malformed" : manifest.code}`, manifestPath));
	const lockfile = await readText(input.lockfilePath);
	if (lockfile.ok) try {
		lockfileHash = await sha256File(input.lockfilePath ?? "");
	} catch {
		lockfileHash = void 0;
	}
	checks.push(check("lockfile", lockfile.ok && validLockfile(lockfile.text), lockfile.ok ? validLockfile(lockfile.text) ? "lockfile is structurally valid" : "lockfile is malformed" : "lockfile is missing or unreadable", input.lockfilePath));
	const workspace = await readText(workspacePath);
	checks.push(check("workspace-policy", workspace.ok && validWorkspacePolicy(workspace.text), workspace.ok ? validWorkspacePolicy(workspace.text) ? "workspace policy is present" : "workspace policy is malformed" : "workspace policy is missing or unreadable", workspacePath));
	const patch = await readText(patchPath);
	checks.push(check("cordis-patch", patch.ok && validPatch(patch.text), patch.ok ? validPatch(patch.text) ? "Cordis patch is present" : "Cordis patch is malformed" : "Cordis patch is missing or unreadable", patchPath));
	if (input.dshPackagePath !== void 0 || input.expectedDshVersion !== void 0) {
		const dsh = await readJson$1(input.dshPackagePath);
		dshVersion = dsh.ok ? packageVersion(dsh.value) : void 0;
		const ok = dsh.ok && packageName(dsh.value) === "@deepseek-ai/dsh" && (input.expectedDshVersion === void 0 || dshVersion === input.expectedDshVersion);
		checks.push(check("dsh-version", ok, ok ? "installed dsh version matches" : "installed dsh version is missing or mismatched", input.dshPackagePath, input.expectedDshVersion, dshVersion));
	}
	for (const item of packageChecks(input)) {
		const packageResult = await inspectPackage(item);
		checks.push(packageResult.checks);
		if (packageResult.hash !== void 0) pluginManifestHashes[item.name] = packageResult.hash;
	}
	const runner = input.runCommand ?? input.commandRunner;
	if (runner !== void 0) {
		const dumpConfig = input.dumpConfig ?? {};
		const args = dumpConfig.args ?? [
			"--profile",
			input.profileName ?? basename(profilePath),
			"--dump-config"
		];
		let commandResult;
		try {
			commandResult = await runner(dumpConfig.command ?? "dsh", args);
		} catch {
			commandResult = void 0;
		}
		const ok = commandResult !== void 0 && resultCode(commandResult) === 0;
		checks.push(check("config-dump", ok, ok ? "config dump completed" : "config dump failed"));
	}
	const ok = checks.every((item) => item.ok);
	const statusRecord = ok ? {
		schemaVersion: 1,
		profilePath,
		...dshVersion === void 0 ? {} : { dshVersion },
		nodeVersion: input.nodeVersion ?? process.version,
		...input.pnpmVersion === void 0 ? {} : { pnpmVersion: input.pnpmVersion },
		...lockfileHash === void 0 ? {} : { lockfileHash },
		pluginManifestHashes,
		checkResult: true
	} : void 0;
	return {
		ok,
		checks,
		...statusRecord === void 0 ? {} : { statusRecord }
	};
}
//#endregion
//#region src/inspect-token-meter.ts
async function readJson(path) {
	try {
		const value = JSON.parse(await readFile(path, "utf8"));
		return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
	} catch {
		return;
	}
}
function fingerprintState(hash, fingerprint) {
	if (fingerprint.patchedHash !== void 0 && hash === fingerprint.patchedHash) return "patched";
	if (fingerprint.unpatchedHash !== void 0 && hash === fingerprint.unpatchedHash) return "unpatched";
	if (fingerprint.expectedHash !== void 0 && hash === fingerprint.expectedHash) return "patched";
	return "mismatch";
}
async function inspectFingerprint(fingerprint) {
	try {
		const hash = await sha256File(fingerprint.path);
		return {
			name: fingerprint.name,
			path: fingerprint.path,
			hash,
			state: fingerprintState(hash, fingerprint)
		};
	} catch (error) {
		const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : void 0;
		return {
			name: fingerprint.name,
			path: fingerprint.path,
			state: code === "ENOENT" ? "missing" : "unknown"
		};
	}
}
function sessionTables(value) {
	const tables = value.tables;
	if (typeof tables === "object" && tables !== null && !Array.isArray(tables)) {
		const sessions = tables.sessions;
		if (typeof sessions === "object" && sessions !== null && !Array.isArray(sessions)) return sessions;
	}
	const sessions = value.sessions;
	return typeof sessions === "object" && sessions !== null && !Array.isArray(sessions) ? sessions : void 0;
}
function collectNegativeValues(value, sessionId, projection, fieldPrefix, output) {
	if (typeof value === "number") {
		if (Number.isFinite(value) && value < 0) output.push({
			sessionId,
			projection,
			field: fieldPrefix,
			value
		});
		return;
	}
	if (typeof value !== "object" || value === null) return;
	if (Array.isArray(value)) {
		for (const [index, child] of value.entries()) collectNegativeValues(child, sessionId, projection, `${fieldPrefix}[${index}]`, output);
		return;
	}
	for (const [key, child] of Object.entries(value)) collectNegativeValues(child, sessionId, projection, fieldPrefix ? `${fieldPrefix}.${key}` : key, output);
}
function scanCache(value) {
	const versions = /* @__PURE__ */ new Set();
	const negativeValues = [];
	const sessions = sessionTables(value);
	if (sessions === void 0) return {
		projectionVersions: [],
		negativeValues: []
	};
	for (const [sessionId, sessionValue] of Object.entries(sessions)) {
		if (typeof sessionValue !== "object" || sessionValue === null || Array.isArray(sessionValue)) continue;
		const rows = sessionValue.rows;
		if (typeof rows !== "object" || rows === null || Array.isArray(rows)) continue;
		for (const [projection, rowValue] of Object.entries(rows)) {
			if (typeof rowValue !== "object" || rowValue === null || Array.isArray(rowValue)) continue;
			const row = rowValue;
			if (typeof row.ver === "number" && Number.isInteger(row.ver) && row.ver >= 0) versions.add(row.ver);
			if ("val" in row) collectNegativeValues(row.val, sessionId, projection, "", negativeValues);
		}
	}
	negativeValues.sort((left, right) => left.sessionId.localeCompare(right.sessionId) || left.projection.localeCompare(right.projection) || left.field.localeCompare(right.field));
	return {
		projectionVersions: [...versions].sort((left, right) => left - right),
		negativeValues
	};
}
function sessionIdFromRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const record = value;
	if (typeof record.id === "string") return record.id;
	if (typeof record.sessionId === "string") return record.sessionId;
	if (typeof record.header === "object" && record.header !== null && !Array.isArray(record.header)) {
		const id = record.header.id;
		if (typeof id === "string") return id;
	}
}
async function readSessionIds(path) {
	try {
		const text = await readFile(path, "utf8");
		const values = [];
		try {
			values.push(JSON.parse(text));
		} catch {
			for (const line of text.split(/\r?\n/)) {
				if (line.trim() === "") continue;
				try {
					values.push(JSON.parse(line));
				} catch {}
			}
		}
		return values.flatMap((value) => {
			const id = sessionIdFromRecord(value);
			return id === void 0 ? [] : [id];
		});
	} catch {
		return [];
	}
}
function packageManifestPath(input) {
	return input.packageManifestPath ?? input.tokenMeterPackagePath;
}
function cachePaths(input) {
	return input.cachePaths ?? [input.cachePath ?? input.projectionCachePath].filter((path) => path !== void 0);
}
function sessionRecordPaths(input) {
	return input.sessionRecordPaths ?? input.sessionPaths ?? [];
}
async function inspectTokenMeter(input) {
	const report = {
		fingerprints: [],
		projectionVersions: [],
		negativeValues: [],
		affectedSessions: []
	};
	const packageJson = await readJson(packageManifestPath(input) ?? "");
	if (typeof packageJson?.version === "string") report.packageVersion = packageJson.version;
	const fingerprints = input.fingerprints ?? [];
	report.fingerprints = await Promise.all(fingerprints.map(inspectFingerprint));
	const affectedIds = /* @__PURE__ */ new Set();
	const projectionVersions = /* @__PURE__ */ new Set();
	for (const path of cachePaths(input)) {
		const cache = await readJson(path);
		if (cache === void 0) continue;
		const scan = scanCache(cache);
		for (const version of scan.projectionVersions) projectionVersions.add(version);
		for (const negativeValue of scan.negativeValues) {
			report.negativeValues.push(negativeValue);
			affectedIds.add(negativeValue.sessionId);
		}
	}
	report.projectionVersions = [...projectionVersions].sort((left, right) => left - right);
	report.negativeValues.sort((left, right) => left.sessionId.localeCompare(right.sessionId) || left.projection.localeCompare(right.projection) || left.field.localeCompare(right.field));
	const recordIds = /* @__PURE__ */ new Set();
	for (const path of sessionRecordPaths(input)) for (const id of await readSessionIds(path)) recordIds.add(id);
	report.affectedSessions = [...affectedIds].filter((id) => recordIds.size === 0 || recordIds.has(id)).sort();
	return report;
}
//#endregion
export { inspectProfile, inspectTokenMeter, sha256, sha256File };
