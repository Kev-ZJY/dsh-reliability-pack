//#region src/hash.d.ts
declare function sha256(value: Uint8Array | string): string;
declare function sha256File(path: string): Promise<string>;
//#endregion
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
export { type CheckItem, type CommandResult, type CommandRunner, type DumpConfigCommand, type FingerprintDefinition, type FingerprintReport, type NegativeValue, type ProfileCheckResult, type ProfileInspectInput, type ProfilePackageCheck, type StatusRecord, type TokenMeterInspectInput, type TokenMeterReport, inspectProfile, inspectTokenMeter, sha256, sha256File };