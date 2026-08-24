export type CommandResult = {
  exitCode?: number;
  code?: number;
  status?: number;
  stdout?: string;
  stderr?: string;
};

export type CommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<CommandResult>;

export type CheckItem = {
  id: string;
  ok: boolean;
  message: string;
  path?: string;
  expected?: string;
  actual?: string;
};

export type StatusRecord = {
  schemaVersion: 1;
  profilePath: string;
  dshVersion?: string;
  nodeVersion: string;
  pnpmVersion?: string;
  lockfileHash?: string;
  pluginManifestHashes: Record<string, string>;
  checkResult: boolean;
};

export type ProfilePackageCheck = {
  name: string;
  manifestPath: string;
  expectedVersion?: string;
  expectedHash?: string;
};

export type DumpConfigCommand = {
  command?: string;
  args?: readonly string[];
};

export type ProfileInspectInput = {
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

export type ProfileCheckResult = {
  ok: boolean;
  checks: CheckItem[];
  statusRecord?: StatusRecord;
};

export type FingerprintDefinition = {
  name: string;
  path: string;
  patchedHash?: string;
  unpatchedHash?: string;
  expectedHash?: string;
};

export type FingerprintReport = {
  name: string;
  path: string;
  hash?: string;
  state: 'patched' | 'unpatched' | 'mismatch' | 'unknown' | 'missing';
};

export type NegativeValue = {
  sessionId: string;
  projection: string;
  field: string;
  value: number;
};

export type TokenMeterInspectInput = {
  packageManifestPath?: string;
  tokenMeterPackagePath?: string;
  fingerprints?: readonly FingerprintDefinition[];
  cachePaths?: readonly string[];
  cachePath?: string;
  projectionCachePath?: string;
  sessionRecordPaths?: readonly string[];
  sessionPaths?: readonly string[];
};

export type TokenMeterReport = {
  packageVersion?: string;
  fingerprints: FingerprintReport[];
  projectionVersions: number[];
  negativeValues: NegativeValue[];
  affectedSessions: string[];
};
