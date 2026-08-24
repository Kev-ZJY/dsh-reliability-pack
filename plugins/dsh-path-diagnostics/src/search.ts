import { basename, dirname } from 'node:path';
import {
  isWithinWorkspace,
  normalizeContainedPath,
  normalizeWorkspaceRoot,
} from './path-safety.ts';

export type PathDiagnosticConfig = {
  enabled: boolean;
  readOnly: true;
  maxDepth: number;
  maxCandidates: number;
  maxSearchEntries: number;
  suggestOnlyWhenUnique: true;
};

export type SearchDirectoryEntry = {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'directory' | 'other';
};

export type SearchPathMetadata = {
  readonly type: 'file' | 'directory' | 'symlink' | 'other';
};

export type ReadOnlySearchAdapter = {
  readonly listDir: (
    path: string,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<SearchDirectoryEntry>>;
  readonly lstat: (
    path: string,
    signal?: AbortSignal,
  ) => Promise<SearchPathMetadata | undefined>;
};

export type SearchResult = { candidate: string } | { reason: string };
type SearchFailure = { reason: string };

export const DEFAULT_PATH_DIAGNOSTIC_CONFIG: PathDiagnosticConfig = {
  enabled: false,
  readOnly: true,
  maxDepth: 4,
  maxCandidates: 8,
  maxSearchEntries: 2000,
  suggestOnlyWhenUnique: true,
};

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR';
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isSearchFailure(value: unknown): value is SearchFailure {
  return typeof value === 'object' && value !== null && 'reason' in value;
}

function invalidConfig(config: PathDiagnosticConfig): boolean {
  return config.readOnly !== true ||
    config.suggestOnlyWhenUnique !== true ||
    !isNonNegativeInteger(config.maxDepth) ||
    !isPositiveInteger(config.maxCandidates) ||
    !isPositiveInteger(config.maxSearchEntries) ||
    config.maxSearchEntries > MAX_SAFE_INTEGER;
}

function resultForAdapterError(error: unknown, signal: AbortSignal | undefined): SearchFailure {
  return aborted(signal) || isAbortError(error) ? { reason: 'aborted' } : { reason: 'search-failed' };
}

async function safeLstat(
  adapter: ReadOnlySearchAdapter,
  path: string,
  signal: AbortSignal | undefined,
): Promise<SearchPathMetadata | undefined | SearchFailure> {
  if (aborted(signal)) return { reason: 'aborted' };
  try {
    const metadata = await adapter.lstat(path, signal);
    if (aborted(signal)) return { reason: 'aborted' };
    return metadata;
  } catch (error) {
    return resultForAdapterError(error, signal);
  }
}

async function safeListDir(
  adapter: ReadOnlySearchAdapter,
  path: string,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<SearchDirectoryEntry> | SearchFailure> {
  if (aborted(signal)) return { reason: 'aborted' };
  try {
    const entries = await adapter.listDir(path, signal);
    if (aborted(signal)) return { reason: 'aborted' };
    return entries;
  } catch (error) {
    return resultForAdapterError(error, signal);
  }
}

export async function searchUniqueCandidate(
  root: string,
  requestedPath: string,
  config: PathDiagnosticConfig,
  adapter: ReadOnlySearchAdapter,
  signal?: AbortSignal,
): Promise<SearchResult> {
  if (!config.enabled) return { reason: 'disabled' };
  if (invalidConfig(config)) return { reason: 'invalid-config' };
  if (aborted(signal)) return { reason: 'aborted' };

  const workspaceRoot = normalizeWorkspaceRoot(root);
  if (workspaceRoot === undefined) return { reason: 'invalid-root' };
  const requested = normalizeContainedPath(workspaceRoot, requestedPath);
  if (requested === undefined) return { reason: 'outside-workspace' };

  const requestedName = basename(requested);
  if (requestedName.length === 0 || requestedName === '.' || requestedName === '..') {
    return { reason: 'invalid-requested-path' };
  }

  const workspaceMetadata = await safeLstat(adapter, workspaceRoot, signal);
  if (isSearchFailure(workspaceMetadata)) return workspaceMetadata;
  if (workspaceMetadata === undefined) return { reason: 'workspace-missing' };
  if (workspaceMetadata.type === 'symlink') return { reason: 'unsafe-workspace' };
  if (workspaceMetadata.type !== 'directory') return { reason: 'workspace-not-directory' };

  const requestedParent = dirname(requested);
  const parentMetadata = await safeLstat(adapter, requestedParent, signal);
  if (isSearchFailure(parentMetadata)) return parentMetadata;
  if (parentMetadata === undefined) return { reason: 'missing-parent' };
  if (parentMetadata.type !== 'directory') return { reason: 'parent-not-directory' };

  const pending: Array<{ path: string; depth: number }> = [{ path: workspaceRoot, depth: 0 }];
  const visited = new Set<string>();
  const candidates: string[] = [];
  let entriesSeen = 0;

  while (pending.length > 0) {
    if (aborted(signal)) return { reason: 'aborted' };
    const current = pending.shift();
    if (current === undefined || visited.has(current.path)) continue;
    visited.add(current.path);

    const listed = await safeListDir(adapter, current.path, signal);
    if (isSearchFailure(listed)) return listed;
    if (listed.length > config.maxSearchEntries - entriesSeen) return { reason: 'search-entry-cap' };
    entriesSeen += listed.length;

    for (const entry of listed) {
      if (aborted(signal)) return { reason: 'aborted' };
      const entryPath = normalizeContainedPath(workspaceRoot, entry.path);
      if (entryPath === undefined || !isWithinWorkspace(current.path, entryPath)) {
        return { reason: 'outside-workspace' };
      }

      const metadata = await safeLstat(adapter, entryPath, signal);
      if (isSearchFailure(metadata)) return metadata;
      if (metadata === undefined || metadata.type === 'symlink' || metadata.type === 'other') continue;

      if (metadata.type === 'file') {
        if (entry.name !== requestedName) continue;
        candidates.push(entryPath);
        if (candidates.length > config.maxCandidates) return { reason: 'candidate-cap' };
        if (candidates.length > 1) return { reason: 'multiple-matches' };
        continue;
      }

      if (metadata.type === 'directory' && entry.type === 'directory' && current.depth < config.maxDepth) {
        pending.push({ path: entryPath, depth: current.depth + 1 });
      }
    }
  }

  return candidates.length === 1 ? { candidate: candidates[0] } : { reason: 'no-match' };
}
