import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { sha256File } from './hash.ts';
import type {
  CheckItem,
  CommandResult,
  ProfileCheckResult,
  ProfileInspectInput,
  ProfilePackageCheck,
  StatusRecord,
} from './types.ts';

type ReadTextResult =
  | { ok: true; text: string }
  | { ok: false; code?: string };

type ReadJsonResult =
  | { ok: true; value: Record<string, unknown>; text: string }
  | { ok: false; code: 'missing' | 'malformed' | 'unreadable' };

async function readText(path: string | undefined): Promise<ReadTextResult> {
  if (path === undefined) return { ok: false, code: 'missing' };
  try {
    return { ok: true, text: await readFile(path, 'utf8') };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : undefined;
    return { ok: false, code };
  }
}

async function readJson(path: string | undefined): Promise<ReadJsonResult> {
  const result = await readText(path);
  if (!result.ok) {
    return { ok: false, code: result.code === 'ENOENT' || result.code === 'missing' ? 'missing' : 'unreadable' };
  }
  try {
    const value: unknown = JSON.parse(result.text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, code: 'malformed' };
    }
    return { ok: true, value: value as Record<string, unknown>, text: result.text };
  } catch {
    return { ok: false, code: 'malformed' };
  }
}

function check(id: string, ok: boolean, message: string, path?: string, expected?: string, actual?: string): CheckItem {
  return {
    id,
    ok,
    message,
    ...(path === undefined ? {} : { path }),
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
  };
}

function validLockfile(text: string): boolean {
  const version = /^\s*lockfileVersion:\s*['"]?(\d+(?:\.\d+)?)['"]?\s*$/m.test(text);
  const importers = /^\s*importers:\s*$/m.test(text);
  const unbalanced = (text.match(/\[/g)?.length ?? 0) !== (text.match(/\]/g)?.length ?? 0)
    || (text.match(/\{/g)?.length ?? 0) !== (text.match(/\}/g)?.length ?? 0);
  return version && importers && !unbalanced;
}

function validWorkspacePolicy(text: string): boolean {
  return /^\s*packages:\s*$/m.test(text);
}

function validPatch(text: string): boolean {
  // Strip comment lines (starting with # after optional whitespace)
  const stripped = text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
    .trim();

  // Empty, whitespace-only, or bare empty array `[]` (with optional whitespace) are valid "empty state"
  if (stripped.length === 0 || /^\[\s*\]$/.test(stripped)) {
    return true;
  }

  // Otherwise require at least one patch entry with id: and name:
  return /^\s*id:\s*\S+/m.test(text) && /^\s*name:\s*\S+/m.test(text);
}

function packageName(value: Record<string, unknown>): string | undefined {
  return typeof value.name === 'string' ? value.name : undefined;
}

function packageVersion(value: Record<string, unknown>): string | undefined {
  return typeof value.version === 'string' ? value.version : undefined;
}

function resultCode(result: CommandResult): number {
  return result.exitCode ?? result.code ?? result.status ?? 1;
}

function packageChecks(input: ProfileInspectInput): readonly ProfilePackageCheck[] {
  return input.packageChecks ?? input.packages ?? [];
}

async function inspectPackage(item: ProfilePackageCheck): Promise<{ checks: CheckItem; hash?: string }> {
  const parsed = await readJson(item.manifestPath);
  let hash: string | undefined;
  try {
    hash = await sha256File(item.manifestPath);
  } catch {
    hash = undefined;
  }

  if (!parsed.ok) {
    return {
      checks: check(
        `package:${item.name}`,
        false,
        `package manifest is ${parsed.code}`,
        item.manifestPath,
      ),
      hash,
    };
  }

  const actualName = packageName(parsed.value);
  const actualVersion = packageVersion(parsed.value);
  const nameOk = actualName === item.name;
  const versionOk = item.expectedVersion === undefined || actualVersion === item.expectedVersion;
  const hashOk = item.expectedHash === undefined || hash === item.expectedHash;
  return {
    checks: check(
      `package:${item.name}`,
      nameOk && versionOk && hashOk,
      nameOk && versionOk && hashOk ? 'package manifest matches' : 'package manifest differs from expectation',
      item.manifestPath,
      item.expectedVersion,
      actualVersion,
    ),
    hash,
  };
}

export async function inspectProfile(input: ProfileInspectInput): Promise<ProfileCheckResult> {
  const profilePath = input.profilePath ?? input.profileRoot ?? '';
  const manifestPath = input.manifestPath ?? input.profileManifestPath;
  const workspacePath = input.workspacePolicyPath ?? input.workspacePath;
  const patchPath = input.cordisPatchPath ?? input.patchPath;
  const checks: CheckItem[] = [];
  let lockfileHash: string | undefined;
  let dshVersion: string | undefined;
  const pluginManifestHashes: Record<string, string> = {};

  const manifest = await readJson(manifestPath);
  const manifestOk = manifest.ok && packageName(manifest.value) !== undefined;
  checks.push(check(
    'profile-manifest',
    manifestOk,
    manifestOk ? 'profile manifest is valid' : `profile manifest is ${manifest.ok ? 'malformed' : manifest.code}`,
    manifestPath,
  ));

  const lockfile = await readText(input.lockfilePath);
  if (lockfile.ok) {
    try {
      lockfileHash = await sha256File(input.lockfilePath ?? '');
    } catch {
      lockfileHash = undefined;
    }
  }
  checks.push(check(
    'lockfile',
    lockfile.ok && validLockfile(lockfile.text),
    lockfile.ok
      ? (validLockfile(lockfile.text) ? 'lockfile is structurally valid' : 'lockfile is malformed')
      : 'lockfile is missing or unreadable',
    input.lockfilePath,
  ));

  const workspace = await readText(workspacePath);
  checks.push(check(
    'workspace-policy',
    workspace.ok && validWorkspacePolicy(workspace.text),
    workspace.ok
      ? (validWorkspacePolicy(workspace.text) ? 'workspace policy is present' : 'workspace policy is malformed')
      : 'workspace policy is missing or unreadable',
    workspacePath,
  ));

  const patch = await readText(patchPath);
  checks.push(check(
    'cordis-patch',
    patch.ok && validPatch(patch.text),
    patch.ok
      ? (validPatch(patch.text) ? 'Cordis patch is present' : 'Cordis patch is malformed')
      : 'Cordis patch is missing or unreadable',
    patchPath,
  ));

  if (input.dshPackagePath !== undefined || input.expectedDshVersion !== undefined) {
    const dsh = await readJson(input.dshPackagePath);
    dshVersion = dsh.ok ? packageVersion(dsh.value) : undefined;
    const ok = dsh.ok
      && packageName(dsh.value) === '@deepseek-ai/dsh'
      && (input.expectedDshVersion === undefined || dshVersion === input.expectedDshVersion);
    checks.push(check(
      'dsh-version',
      ok,
      ok ? 'installed dsh version matches' : 'installed dsh version is missing or mismatched',
      input.dshPackagePath,
      input.expectedDshVersion,
      dshVersion,
    ));
  }

  for (const item of packageChecks(input)) {
    const packageResult = await inspectPackage(item);
    checks.push(packageResult.checks);
    if (packageResult.hash !== undefined) pluginManifestHashes[item.name] = packageResult.hash;
  }

  const runner = input.runCommand ?? input.commandRunner;
  if (runner !== undefined) {
    const dumpConfig = input.dumpConfig ?? {};
    const args = dumpConfig.args ?? [
      '--profile',
      input.profileName ?? basename(profilePath),
      '--dump-config',
    ];
    let commandResult: CommandResult | undefined;
    try {
      commandResult = await runner(dumpConfig.command ?? 'dsh', args);
    } catch {
      commandResult = undefined;
    }
    const ok = commandResult !== undefined && resultCode(commandResult) === 0;
    checks.push(check(
      'config-dump',
      ok,
      ok ? 'config dump completed' : 'config dump failed',
    ));
  }

  const ok = checks.every((item) => item.ok);
  const statusRecord: StatusRecord | undefined = ok
    ? {
      schemaVersion: 1,
      profilePath,
      ...(dshVersion === undefined ? {} : { dshVersion }),
      nodeVersion: input.nodeVersion ?? process.version,
      ...(input.pnpmVersion === undefined ? {} : { pnpmVersion: input.pnpmVersion }),
      ...(lockfileHash === undefined ? {} : { lockfileHash }),
      pluginManifestHashes,
      checkResult: true,
    }
    : undefined;

  return { ok, checks, ...(statusRecord === undefined ? {} : { statusRecord }) };
}
