import { readFile } from 'node:fs/promises';
import { sha256File } from './hash.ts';
import type {
  FingerprintDefinition,
  FingerprintReport,
  NegativeValue,
  TokenMeterInspectInput,
  TokenMeterReport,
} from './types.ts';

type JsonObject = Record<string, unknown>;

async function readJson(path: string): Promise<JsonObject | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as JsonObject
      : undefined;
  } catch {
    return undefined;
  }
}

function fingerprintState(
  hash: string,
  fingerprint: FingerprintDefinition,
): FingerprintReport['state'] {
  if (fingerprint.patchedHash !== undefined && hash === fingerprint.patchedHash) return 'patched';
  if (fingerprint.unpatchedHash !== undefined && hash === fingerprint.unpatchedHash) return 'unpatched';
  if (fingerprint.expectedHash !== undefined && hash === fingerprint.expectedHash) return 'patched';
  return 'mismatch';
}

async function inspectFingerprint(fingerprint: FingerprintDefinition): Promise<FingerprintReport> {
  try {
    const hash = await sha256File(fingerprint.path);
    return {
      name: fingerprint.name,
      path: fingerprint.path,
      hash,
      state: fingerprintState(hash, fingerprint),
    };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : undefined;
    return {
      name: fingerprint.name,
      path: fingerprint.path,
      state: code === 'ENOENT' ? 'missing' : 'unknown',
    };
  }
}

function sessionTables(value: JsonObject): JsonObject | undefined {
  const tables = value.tables;
  if (typeof tables === 'object' && tables !== null && !Array.isArray(tables)) {
    const sessions = (tables as JsonObject).sessions;
    if (typeof sessions === 'object' && sessions !== null && !Array.isArray(sessions)) {
      return sessions as JsonObject;
    }
  }
  const sessions = value.sessions;
  return typeof sessions === 'object' && sessions !== null && !Array.isArray(sessions)
    ? sessions as JsonObject
    : undefined;
}

function collectNegativeValues(
  value: unknown,
  sessionId: string,
  projection: string,
  fieldPrefix: string,
  output: NegativeValue[],
): void {
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value < 0) {
      output.push({
        sessionId,
        projection,
        field: fieldPrefix,
        value,
      });
    }
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      collectNegativeValues(child, sessionId, projection, `${fieldPrefix}[${index}]`, output);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as JsonObject)) {
    collectNegativeValues(child, sessionId, projection, fieldPrefix ? `${fieldPrefix}.${key}` : key, output);
  }
}

function scanCache(value: JsonObject): { projectionVersions: number[]; negativeValues: NegativeValue[] } {
  const versions = new Set<number>();
  const negativeValues: NegativeValue[] = [];
  const sessions = sessionTables(value);
  if (sessions === undefined) return { projectionVersions: [], negativeValues: [] };

  for (const [sessionId, sessionValue] of Object.entries(sessions)) {
    if (typeof sessionValue !== 'object' || sessionValue === null || Array.isArray(sessionValue)) continue;
    const rows = (sessionValue as JsonObject).rows;
    if (typeof rows !== 'object' || rows === null || Array.isArray(rows)) continue;
    for (const [projection, rowValue] of Object.entries(rows as JsonObject)) {
      if (typeof rowValue !== 'object' || rowValue === null || Array.isArray(rowValue)) continue;
      const row = rowValue as JsonObject;
      if (typeof row.ver === 'number' && Number.isInteger(row.ver) && row.ver >= 0) versions.add(row.ver);
      if ('val' in row) collectNegativeValues(row.val, sessionId, projection, '', negativeValues);
    }
  }

  negativeValues.sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId)
    || left.projection.localeCompare(right.projection)
    || left.field.localeCompare(right.field));
  return {
    projectionVersions: [...versions].sort((left, right) => left - right),
    negativeValues,
  };
}

function sessionIdFromRecord(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as JsonObject;
  if (typeof record.id === 'string') return record.id;
  if (typeof record.sessionId === 'string') return record.sessionId;
  if (typeof record.header === 'object' && record.header !== null && !Array.isArray(record.header)) {
    const id = (record.header as JsonObject).id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

async function readSessionIds(path: string): Promise<string[]> {
  try {
    const text = await readFile(path, 'utf8');
    const values: unknown[] = [];
    try {
      values.push(JSON.parse(text));
    } catch {
      for (const line of text.split(/\r?\n/)) {
        if (line.trim() === '') continue;
        try {
          values.push(JSON.parse(line));
        } catch {
          // A malformed record cannot safely identify a session.
        }
      }
    }
    return values.flatMap((value) => {
      const id = sessionIdFromRecord(value);
      return id === undefined ? [] : [id];
    });
  } catch {
    return [];
  }
}

function packageManifestPath(input: TokenMeterInspectInput): string | undefined {
  return input.packageManifestPath ?? input.tokenMeterPackagePath;
}

function cachePaths(input: TokenMeterInspectInput): readonly string[] {
  return input.cachePaths ?? [input.cachePath ?? input.projectionCachePath].filter(
    (path): path is string => path !== undefined,
  );
}

function sessionRecordPaths(input: TokenMeterInspectInput): readonly string[] {
  return input.sessionRecordPaths ?? input.sessionPaths ?? [];
}

export async function inspectTokenMeter(input: TokenMeterInspectInput): Promise<TokenMeterReport> {
  const report: TokenMeterReport = {
    fingerprints: [],
    projectionVersions: [],
    negativeValues: [],
    affectedSessions: [],
  };

  const packageJson = await readJson(packageManifestPath(input) ?? '');
  if (typeof packageJson?.version === 'string') report.packageVersion = packageJson.version;

  const fingerprints = input.fingerprints ?? [];
  report.fingerprints = await Promise.all(fingerprints.map(inspectFingerprint));

  const affectedIds = new Set<string>();
  const projectionVersions = new Set<number>();
  for (const path of cachePaths(input)) {
    const cache = await readJson(path);
    if (cache === undefined) continue;
    const scan = scanCache(cache);
    for (const version of scan.projectionVersions) projectionVersions.add(version);
    for (const negativeValue of scan.negativeValues) {
      report.negativeValues.push(negativeValue);
      affectedIds.add(negativeValue.sessionId);
    }
  }
  report.projectionVersions = [...projectionVersions].sort((left, right) => left - right);
  report.negativeValues.sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId)
    || left.projection.localeCompare(right.projection)
    || left.field.localeCompare(right.field));

  const recordIds = new Set<string>();
  for (const path of sessionRecordPaths(input)) {
    for (const id of await readSessionIds(path)) recordIds.add(id);
  }
  report.affectedSessions = [...affectedIds]
    .filter((id) => recordIds.size === 0 || recordIds.has(id))
    .sort();
  return report;
}
