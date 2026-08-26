import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import type {
  CommandResult,
  CommandRunner,
  ProfileCheckResult,
  ProfileInspectInput,
  TokenMeterInspectInput,
  TokenMeterReport,
} from './types.ts';
import { inspectProfile } from './inspect-profile.ts';
import { inspectTokenMeter } from './inspect-token-meter.ts';
import { createBackup, type BackupManifest } from './backup.ts';

export type DoctorCommand = 'check' | 'report-token-meter' | 'update-profile';

export type ParsedDoctorArgs = {
  command: DoctorCommand;
  profile: string;
  preview: boolean;
};

export type ProfileUpdateArgs = ProfileInspectInput & {
  profile: string;
  profileRoot: string;
  preview?: boolean;
  timestamp?: string;
};

export type DoctorIO = {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  commandRunner?: CommandRunner;
  inspectProfile?: typeof inspectProfile;
  inspectTokenMeter?: typeof inspectTokenMeter;
  createBackup?: typeof createBackup;
};

function output(io: DoctorIO, text: string): void {
  (io.stdout ?? ((value) => process.stdout.write(`${value}\n`)))(text);
}

function errorOutput(io: DoctorIO, text: string): void {
  (io.stderr ?? ((value) => process.stderr.write(`${value}\n`)))(text);
}

function resultCode(result: CommandResult | undefined): number {
  return result?.exitCode ?? result?.code ?? result?.status ?? 1;
}

export function redactSecrets(text: string): string {
  let redacted = text.replace(
    /((?:api[_-]?key|access[_-]?token|authorization|password|secret|token)\s*[:=]\s*)(["']?)([^,\s}\]"']+)\2/gi,
    '$1$2[REDACTED]$2',
  );
  redacted = redacted.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  return redacted.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9][A-Za-z0-9_-]{5,}\b/g, '[REDACTED]');
}

function formatCheckResult(result: ProfileCheckResult): string {
  return result.checks.map((check) => {
    const state = check.ok ? 'ok' : 'failed';
    const details = [
      check.message,
      check.path === undefined ? undefined : `path=${check.path}`,
      check.expected === undefined ? undefined : `expected=${check.expected}`,
      check.actual === undefined ? undefined : `actual=${check.actual}`,
    ].filter((value): value is string => value !== undefined);
    return `[${state}] ${check.id}: ${details.join('; ')}`;
  }).join('\n');
}

function formatTokenMeterReport(report: TokenMeterReport): string {
  return JSON.stringify(report, null, 2);
}

export async function defaultCommandRunner(
  command: string,
  args: readonly string[],
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(command, [...args], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error !== null) {
        const code = typeof error.code === 'number'
          ? error.code
          : typeof error.code === 'string' && /^\d+$/.test(error.code)
            ? Number(error.code)
            : 1;
        resolve({ exitCode: code, stdout, stderr });
        return;
      }
      resolve({ exitCode: 0, stdout, stderr });
    });
  });
}

function runnerFor(args: ProfileInspectInput, io: DoctorIO): CommandRunner {
  return args.runCommand ?? args.commandRunner ?? io.commandRunner ?? defaultCommandRunner;
}

export function parseDoctorArgs(argv: readonly string[]): ParsedDoctorArgs {
  const command = argv[0];
  if (command !== 'check' && command !== 'report-token-meter' && command !== 'update-profile') {
    throw new Error('expected check, report-token-meter, or update-profile');
  }

  let profile: string | undefined;
  let preview = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--profile') {
      profile = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--preview' && command === 'update-profile') {
      preview = true;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (profile === undefined || profile.length === 0) throw new Error('--profile is required');
  if (preview && command !== 'update-profile') throw new Error('--preview is only valid for update-profile');
  return { command, profile, preview };
}

export async function runCheck(args: ProfileInspectInput, io: DoctorIO = {}): Promise<number> {
  const inspector = io.inspectProfile ?? inspectProfile;
  const runner = runnerFor(args, io);
  try {
    const result = await inspector({
      ...args,
      runCommand: runner,
      profileName: args.profileName ?? (args.profileRoot === undefined ? undefined : basename(args.profileRoot)),
    });
    const message = redactSecrets(formatCheckResult(result));
    (result.ok ? output : errorOutput)(io, message);
    return result.ok ? 0 : 1;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    errorOutput(io, `check failed: ${redactSecrets(message)}`);
    return 1;
  }
}

export async function runTokenMeterReport(
  args: TokenMeterInspectInput,
  io: DoctorIO = {},
): Promise<number> {
  const inspector = io.inspectTokenMeter ?? inspectTokenMeter;
  try {
    const report = await inspector(args);
    output(io, redactSecrets(formatTokenMeterReport(report)));
    return 0;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    errorOutput(io, `token-meter report failed: ${redactSecrets(message)}`);
    return 1;
  }
}

function updateCommand(profile: string): readonly string[] {
  return ['plugin', '--profile', profile, 'update'];
}

function dumpConfigCommand(profile: string): readonly string[] {
  return ['--profile', profile, '--dump-config'];
}

function backupFailureMessage(backup: BackupManifest, detail: string): string {
  const suffix = detail.length === 0 ? '' : ` ${redactSecrets(detail)}`;
  return `${suffix.trim()} backup: ${backup.directory}`.trim();
}

export async function runProfileUpdate(
  args: ProfileUpdateArgs,
  io: DoctorIO = {},
): Promise<number> {
  if (args.preview === true) {
    output(io, `preview: would update profile ${redactSecrets(args.profile)}; no files changed`);
    return 0;
  }

  const makeBackup = io.createBackup ?? createBackup;
  let backup: BackupManifest;
  try {
    backup = await makeBackup(args.profileRoot, args.timestamp);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    errorOutput(io, `profile backup failed: ${redactSecrets(message)}`);
    return 1;
  }

  const runner = runnerFor(args, io);
  let updateResult: CommandResult | undefined;
  try {
    updateResult = await runner('dsh', updateCommand(args.profile));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    errorOutput(io, `profile update failed: ${backupFailureMessage(backup, message)}`);
    return 1;
  }
  if (resultCode(updateResult) !== 0) {
    errorOutput(io, `profile update failed with exit code ${resultCode(updateResult)}: ${backupFailureMessage(backup, updateResult.stderr ?? '')}`);
    return 1;
  }

  const inspector = io.inspectProfile ?? inspectProfile;
  const validationInput: ProfileInspectInput = {
    ...args,
    profilePath: args.profilePath ?? args.profileRoot,
    profileName: args.profile,
    runCommand: runner,
    dumpConfig: {
      command: 'dsh',
      args: dumpConfigCommand(args.profile),
    },
  };
  let validation: ProfileCheckResult;
  try {
    validation = await inspector(validationInput);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    errorOutput(io, `post-update validation could not run (validator error: ${redactSecrets(message)}; update itself exited 0); backup: ${backup.directory}`);
    return 0;
  }
  if (!validation.ok) {
    errorOutput(io, `post-update validation failed: ${backupFailureMessage(backup, formatCheckResult(validation))}`);
    return 1;
  }

  output(io, `profile update validated; backup: ${backup.directory}`);
  return 0;
}
