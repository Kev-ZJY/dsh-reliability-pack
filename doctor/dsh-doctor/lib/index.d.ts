//#region src/types.d.ts
type CommandResult = {
  exitCode?: number;
  code?: number;
  status?: number;
  stdout?: string;
  stderr?: string;
};
type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>;
type CheckItem = {
  id: string;
  ok: boolean;
  message: string;
  path?: string;
  expected?: string;
  actual?: string;
};
type StatusRecord = {
  schemaVersion: 1;
  profilePath: string;
  dshVersion?: string;
  nodeVersion: string;
  pnpmVersion?: string;
  lockfileHash?: string;
  pluginManifestHashes: Record<string, string>;
  checkResult: boolean;
};
type ProfilePackageCheck = {
  name: string;
  manifestPath: string;
  expectedVersion?: string;
  expectedHash?: string;
};
type DumpConfigCommand = {
  command?: string;
  args?: readonly string[];
};
type ProfileInspectInput = {
  profilePath?: string;
  profileRoot?: string;
  profileName?: string;
  manifestPath?: string;
  profileManifestPath?: string;
  lockfilePath?: string;
  workspacePolicyPath?: string;
  workspacePath?: string;
  cordisPatchPath?: string;
  patchPath?: string;
  dshPackagePath?: string;
  expectedDshVersion?: string;
  packageChecks?: readonly ProfilePackageCheck[];
  packages?: readonly ProfilePackageCheck[];
  runCommand?: CommandRunner;
  commandRunner?: CommandRunner;
  dumpConfig?: DumpConfigCommand;
  nodeVersion?: string;
  pnpmVersion?: string;
};
type ProfileCheckResult = {
  ok: boolean;
  checks: CheckItem[];
  statusRecord?: StatusRecord;
};
type FingerprintDefinition = {
  name: string;
  path: string;
  patchedHash?: string;
  unpatchedHash?: string;
  expectedHash?: string;
};
type FingerprintReport = {
  name: string;
  path: string;
  hash?: string;
  state: 'patched' | 'unpatched' | 'mismatch' | 'unknown' | 'missing';
};
type NegativeValue = {
  sessionId: string;
  projection: string;
  field: string;
  value: number;
};
type TokenMeterInspectInput = {
  packageManifestPath?: string;
  tokenMeterPackagePath?: string;
  fingerprints?: readonly FingerprintDefinition[];
  cachePaths?: readonly string[];
  cachePath?: string;
  projectionCachePath?: string;
  sessionRecordPaths?: readonly string[];
  sessionPaths?: readonly string[];
};
type TokenMeterReport = {
  packageVersion?: string;
  fingerprints: FingerprintReport[];
  projectionVersions: number[];
  negativeValues: NegativeValue[];
  affectedSessions: string[];
};
//#endregion
//#region src/inspect-profile.d.ts
declare function inspectProfile(input: ProfileInspectInput): Promise<ProfileCheckResult>;
//#endregion
//#region src/inspect-token-meter.d.ts
declare function inspectTokenMeter(input: TokenMeterInspectInput): Promise<TokenMeterReport>;
//#endregion
//#region src/backup.d.ts
type BackupFileName = 'profile-manifest' | 'lockfile' | 'workspace-policy' | 'cordis-patch';
type BackupFile = {
  name: BackupFileName;
  sourcePath: string;
  backupPath: string;
  sha256: string;
};
type BackupManifest = {
  schemaVersion: 1;
  createdAt: string;
  directory: string;
  files: BackupFile[];
  manifestPath: string;
};
declare function createBackup(profileRoot: string, timestamp?: string): Promise<BackupManifest>;
//#endregion
//#region src/commands.d.ts
type DoctorCommand = 'check' | 'report-token-meter' | 'update-profile';
type ParsedDoctorArgs = {
  command: DoctorCommand;
  profile: string;
  preview: boolean;
};
type ProfileUpdateArgs = ProfileInspectInput & {
  profile: string;
  profileRoot: string;
  preview?: boolean;
  timestamp?: string;
};
type DoctorIO = {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  commandRunner?: CommandRunner;
  inspectProfile?: typeof inspectProfile;
  inspectTokenMeter?: typeof inspectTokenMeter;
  createBackup?: typeof createBackup;
};
declare function redactSecrets(text: string): string;
declare function defaultCommandRunner(command: string, args: readonly string[]): Promise<CommandResult>;
declare function parseDoctorArgs(argv: readonly string[]): ParsedDoctorArgs;
declare function runCheck(args: ProfileInspectInput, io?: DoctorIO): Promise<number>;
declare function runTokenMeterReport(args: TokenMeterInspectInput, io?: DoctorIO): Promise<number>;
declare function runProfileUpdate(args: ProfileUpdateArgs, io?: DoctorIO): Promise<number>;
//#endregion
//#region src/hash.d.ts
declare function sha256(value: Uint8Array | string): string;
declare function sha256File(path: string): Promise<string>;
//#endregion
//#region src/index.d.ts
type DoctorCliPaths = {
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
declare function resolveDoctorPaths(profile: string, environment?: NodeJS.ProcessEnv): DoctorCliPaths;
declare function runDoctorCli(argv?: readonly string[], environment?: NodeJS.ProcessEnv, io?: DoctorIO): Promise<number>;
//#endregion
export { BackupFile, BackupFileName, BackupManifest, type CheckItem, type CommandResult, type CommandRunner, DoctorCliPaths, DoctorCommand, DoctorIO, type DumpConfigCommand, type FingerprintDefinition, type FingerprintReport, type NegativeValue, ParsedDoctorArgs, type ProfileCheckResult, type ProfileInspectInput, type ProfilePackageCheck, ProfileUpdateArgs, type StatusRecord, type TokenMeterInspectInput, type TokenMeterReport, createBackup, defaultCommandRunner, inspectProfile, inspectTokenMeter, parseDoctorArgs, redactSecrets, resolveDoctorPaths, runCheck, runDoctorCli, runProfileUpdate, runTokenMeterReport, sha256, sha256File };