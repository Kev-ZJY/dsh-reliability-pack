#!/usr/bin/env node

import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  defaultCommandRunner,
  parseDoctorArgs,
  redactSecrets,
  runCheck,
  runProfileUpdate,
  runTokenMeterReport,
  type DoctorIO,
} from './commands.ts';
import type { ProfileInspectInput, TokenMeterInspectInput } from './types.ts';

export type DoctorCliPaths = {
  home: string;
  profileRoot: string;
  profileManifestPath: string;
  lockfilePath: string;
  workspacePolicyPath: string;
  cordisPatchPath: string;
  tokenMeterPackagePath: string;
  cachePaths: readonly string[];
  sessionRecordPaths: readonly string[];
};

function environmentPath(environment: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = environment[key];
  return value === undefined || value.length === 0 ? fallback : value;
}

function listPaths(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) return [];
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function validateProfileName(profile: string): void {
  if (profile.length === 0 || profile === '.' || profile === '..' || isAbsolute(profile) || /[\\/]/.test(profile)) {
    throw new Error(`invalid profile name: ${profile}`);
  }
}

export function resolveDoctorPaths(
  profile: string,
  environment: NodeJS.ProcessEnv = process.env,
): DoctorCliPaths {
  validateProfileName(profile);
  const home = resolve(environmentPath(
    environment,
    'DSH_DOCTOR_HOME',
    environmentPath(environment, 'DSH_HOME', join(homedir(), '.dsh')),
  ));
  const profileRoot = resolve(environmentPath(
    environment,
    'DSH_DOCTOR_PROFILE_ROOT',
    join(home, 'profiles', profile),
  ));
  const storageRoot = join(home, 'storages');
  const cacheOverride = environment['DSH_DOCTOR_TOKEN_METER_CACHE'];
  const sessionOverride = environment['DSH_DOCTOR_SESSION_RECORDS'];

  return {
    home,
    profileRoot,
    profileManifestPath: resolve(environmentPath(
      environment,
      'DSH_DOCTOR_PROFILE_MANIFEST',
      join(profileRoot, 'package.json'),
    )),
    lockfilePath: resolve(environmentPath(
      environment,
      'DSH_DOCTOR_LOCKFILE',
      join(profileRoot, 'pnpm-lock.yaml'),
    )),
    workspacePolicyPath: resolve(environmentPath(
      environment,
      'DSH_DOCTOR_WORKSPACE_POLICY',
      join(profileRoot, 'pnpm-workspace.yaml'),
    )),
    cordisPatchPath: resolve(environmentPath(
      environment,
      'DSH_DOCTOR_CORDIS_PATCH',
      join(profileRoot, 'cordis.patch.yml'),
    )),
    tokenMeterPackagePath: resolve(environmentPath(
      environment,
      'DSH_DOCTOR_TOKEN_METER_PACKAGE',
      join(home, 'node_modules/@deepseek-ai/dsh-token-meter/package.json'),
    )),
    cachePaths: cacheOverride === undefined
      ? [join(storageRoot, 'session_projcache.json')]
      : listPaths(cacheOverride).map((path) => resolve(path)),
    sessionRecordPaths: listPaths(sessionOverride).map((path) => resolve(path)),
  };
}

function cliIO(): DoctorIO {
  return {
    commandRunner: defaultCommandRunner,
  };
}

export async function runDoctorCli(
  argv: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
  io: DoctorIO = cliIO(),
): Promise<number> {
  let parsed;
  try {
    parsed = parseDoctorArgs(argv);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    (io.stderr ?? ((text) => process.stderr.write(`${text}\n`)))
      (`usage: dsh-doctor <check|report-token-meter|update-profile> --profile <name> [--preview]\n${redactSecrets(message)}`);
    return 2;
  }

  try {
    const paths = resolveDoctorPaths(parsed.profile, environment);
    const profileInput: ProfileInspectInput = {
      profilePath: paths.profileRoot,
      profileRoot: paths.profileRoot,
      profileName: parsed.profile,
      manifestPath: paths.profileManifestPath,
      lockfilePath: paths.lockfilePath,
      workspacePolicyPath: paths.workspacePolicyPath,
      cordisPatchPath: paths.cordisPatchPath,
    };

    if (parsed.command === 'check') {
      return runCheck(profileInput, io);
    }
    if (parsed.command === 'report-token-meter') {
      const tokenMeterInput: TokenMeterInspectInput = {
        packageManifestPath: paths.tokenMeterPackagePath,
        cachePaths: paths.cachePaths,
        sessionRecordPaths: paths.sessionRecordPaths,
      };
      return runTokenMeterReport(tokenMeterInput, io);
    }
    return runProfileUpdate({
      ...profileInput,
      profile: parsed.profile,
      profileRoot: paths.profileRoot,
      preview: parsed.preview,
    }, io);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    (io.stderr ?? ((text) => process.stderr.write(`${text}\n`)))
      (`dsh-doctor failed: ${redactSecrets(message)}`);
    return 1;
  }
}

function invokedAsCli(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(entry) === resolve(currentFile) || basename(entry) === 'dsh-doctor';
}

if (invokedAsCli()) {
  runDoctorCli().then((code) => {
    process.exitCode = code;
  }).catch((caught: unknown) => {
    const message = caught instanceof Error ? caught.message : String(caught);
    process.stderr.write(`dsh-doctor failed: ${redactSecrets(message)}\n`);
    process.exitCode = 1;
  });
}

export * from './hash.ts';
export * from './inspect-profile.ts';
export * from './inspect-token-meter.ts';
export * from './backup.ts';
export * from './commands.ts';
export type * from './types.ts';
