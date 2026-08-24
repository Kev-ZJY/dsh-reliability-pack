import {
  DEFAULT_PATH_DIAGNOSTIC_CONFIG,
  type PathDiagnosticConfig,
} from './search.ts';

export {
  DEFAULT_PATH_DIAGNOSTIC_CONFIG,
  searchUniqueCandidate,
  type PathDiagnosticConfig,
  type ReadOnlySearchAdapter,
  type SearchDirectoryEntry,
  type SearchPathMetadata,
  type SearchResult,
} from './search.ts';
export {
  isWithinWorkspace,
  normalizeContainedPath,
  normalizeWorkspaceRoot,
} from './path-safety.ts';

export const name = 'dsh-path-diagnostics';

export function apply(
  _ctx: unknown,
  _config: PathDiagnosticConfig = DEFAULT_PATH_DIAGNOSTIC_CONFIG,
): void {
  // Task 2 wires this scaffold to the verified tools/post-execute seam.
}

export default apply;
