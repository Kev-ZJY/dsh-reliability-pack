import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
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
function resultCode$1(result) {
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
		const ok = commandResult !== void 0 && resultCode$1(commandResult) === 0;
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
//#region src/backup.ts
const BACKUP_INPUTS = [
	{
		name: "profile-manifest",
		filename: "package.json"
	},
	{
		name: "lockfile",
		filename: "pnpm-lock.yaml"
	},
	{
		name: "workspace-policy",
		filename: "pnpm-workspace.yaml"
	},
	{
		name: "cordis-patch",
		filename: "cordis.patch.yml"
	}
];
function safeTimestamp(timestamp) {
	return timestamp.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || `backup-${Date.now()}`;
}
async function createBackup(profileRoot, timestamp = (/* @__PURE__ */ new Date()).toISOString()) {
	const root = resolve(profileRoot);
	const sources = BACKUP_INPUTS.map((input) => ({
		...input,
		sourcePath: join(root, input.filename)
	}));
	for (const source of sources) if (!(await lstat(source.sourcePath)).isFile()) throw new Error(`${source.filename} is not a regular profile file`);
	const createdAt = (/* @__PURE__ */ new Date()).toISOString();
	const directory = join(root, ".dsh-doctor", "backups", safeTimestamp(timestamp));
	await mkdir(directory, { recursive: true });
	const files = [];
	for (const source of sources) {
		const backupPath = join(directory, source.filename);
		await copyFile(source.sourcePath, backupPath);
		files.push({
			name: source.name,
			sourcePath: source.sourcePath,
			backupPath,
			sha256: await sha256File(backupPath)
		});
	}
	const manifestPath = join(directory, "manifest.json");
	const manifest = {
		schemaVersion: 1,
		createdAt,
		directory,
		files,
		manifestPath
	};
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	return manifest;
}
//#endregion
//#region src/commands.ts
function output(io, text) {
	(io.stdout ?? ((value) => process.stdout.write(`${value}\n`)))(text);
}
function errorOutput(io, text) {
	(io.stderr ?? ((value) => process.stderr.write(`${value}\n`)))(text);
}
function resultCode(result) {
	return result?.exitCode ?? result?.code ?? result?.status ?? 1;
}
function redactSecrets(text) {
	let redacted = text.replace(/((?:api[_-]?key|access[_-]?token|authorization|password|secret|token)\s*[:=]\s*)(["']?)([^,\s}\]"']+)\2/gi, "$1$2[REDACTED]$2");
	redacted = redacted.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
	return redacted.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9][A-Za-z0-9_-]{5,}\b/g, "[REDACTED]");
}
function formatCheckResult(result) {
	return result.checks.map((check) => {
		const state = check.ok ? "ok" : "failed";
		const details = [
			check.message,
			check.path === void 0 ? void 0 : `path=${check.path}`,
			check.expected === void 0 ? void 0 : `expected=${check.expected}`,
			check.actual === void 0 ? void 0 : `actual=${check.actual}`
		].filter((value) => value !== void 0);
		return `[${state}] ${check.id}: ${details.join("; ")}`;
	}).join("\n");
}
function formatTokenMeterReport(report) {
	return JSON.stringify(report, null, 2);
}
async function defaultCommandRunner(command, args) {
	return new Promise((resolve) => {
		execFile(command, [...args], { encoding: "utf8" }, (error, stdout, stderr) => {
			if (error !== null) {
				resolve({
					exitCode: typeof error.code === "number" ? error.code : typeof error.code === "string" && /^\d+$/.test(error.code) ? Number(error.code) : 1,
					stdout,
					stderr
				});
				return;
			}
			resolve({
				exitCode: 0,
				stdout,
				stderr
			});
		});
	});
}
function runnerFor(args, io) {
	return args.runCommand ?? args.commandRunner ?? io.commandRunner ?? defaultCommandRunner;
}
function parseDoctorArgs(argv) {
	const command = argv[0];
	if (command !== "check" && command !== "report-token-meter" && command !== "update-profile") throw new Error("expected check, report-token-meter, or update-profile");
	let profile;
	let preview = false;
	for (let index = 1; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--profile") {
			profile = argv[index + 1];
			index += 1;
			continue;
		}
		if (argument === "--preview" && command === "update-profile") {
			preview = true;
			continue;
		}
		throw new Error(`unknown argument: ${argument}`);
	}
	if (profile === void 0 || profile.length === 0) throw new Error("--profile is required");
	if (preview && command !== "update-profile") throw new Error("--preview is only valid for update-profile");
	return {
		command,
		profile,
		preview
	};
}
async function runCheck(args, io = {}) {
	const inspector = io.inspectProfile ?? inspectProfile;
	const runner = runnerFor(args, io);
	try {
		const result = await inspector({
			...args,
			runCommand: runner,
			profileName: args.profileName ?? (args.profileRoot === void 0 ? void 0 : basename(args.profileRoot))
		});
		const message = redactSecrets(formatCheckResult(result));
		(result.ok ? output : errorOutput)(io, message);
		return result.ok ? 0 : 1;
	} catch (caught) {
		errorOutput(io, `check failed: ${redactSecrets(caught instanceof Error ? caught.message : String(caught))}`);
		return 1;
	}
}
async function runTokenMeterReport(args, io = {}) {
	const inspector = io.inspectTokenMeter ?? inspectTokenMeter;
	try {
		output(io, redactSecrets(formatTokenMeterReport(await inspector(args))));
		return 0;
	} catch (caught) {
		errorOutput(io, `token-meter report failed: ${redactSecrets(caught instanceof Error ? caught.message : String(caught))}`);
		return 1;
	}
}
function updateCommand(profile) {
	return [
		"plugin",
		"--profile",
		profile,
		"update"
	];
}
function dumpConfigCommand(profile) {
	return [
		"--profile",
		profile,
		"--dump-config"
	];
}
function backupFailureMessage(backup, detail) {
	return `${(detail.length === 0 ? "" : ` ${redactSecrets(detail)}`).trim()} backup: ${backup.directory}`.trim();
}
async function runProfileUpdate(args, io = {}) {
	if (args.preview === true) {
		output(io, `preview: would update profile ${redactSecrets(args.profile)}; no files changed`);
		return 0;
	}
	const makeBackup = io.createBackup ?? createBackup;
	let backup;
	try {
		backup = await makeBackup(args.profileRoot, args.timestamp);
	} catch (caught) {
		errorOutput(io, `profile backup failed: ${redactSecrets(caught instanceof Error ? caught.message : String(caught))}`);
		return 1;
	}
	const runner = runnerFor(args, io);
	let updateResult;
	try {
		updateResult = await runner("dsh", updateCommand(args.profile));
	} catch (caught) {
		const message = caught instanceof Error ? caught.message : String(caught);
		errorOutput(io, `profile update failed: ${backupFailureMessage(backup, message)}`);
		return 1;
	}
	if (resultCode(updateResult) !== 0) {
		errorOutput(io, `profile update failed with exit code ${resultCode(updateResult)}: ${backupFailureMessage(backup, updateResult.stderr ?? "")}`);
		return 1;
	}
	const inspector = io.inspectProfile ?? inspectProfile;
	const validationInput = {
		...args,
		profilePath: args.profilePath ?? args.profileRoot,
		profileName: args.profile,
		runCommand: runner,
		dumpConfig: {
			command: "dsh",
			args: dumpConfigCommand(args.profile)
		}
	};
	try {
		const validation = await inspector(validationInput);
		if (!validation.ok) {
			errorOutput(io, `post-update validation failed: ${backupFailureMessage(backup, formatCheckResult(validation))}`);
			return 1;
		}
	} catch (caught) {
		const message = caught instanceof Error ? caught.message : String(caught);
		errorOutput(io, `post-update validation failed: ${backupFailureMessage(backup, message)}`);
		return 1;
	}
	output(io, `profile update validated; backup: ${backup.directory}`);
	return 0;
}
//#endregion
export { createBackup, defaultCommandRunner, inspectProfile, inspectTokenMeter, parseDoctorArgs, redactSecrets, runCheck, runProfileUpdate, runTokenMeterReport, sha256, sha256File };
