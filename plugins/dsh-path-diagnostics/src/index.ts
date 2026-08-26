import {
  DEFAULT_PATH_DIAGNOSTIC_CONFIG,
  type PathDiagnosticConfig,
} from './search.ts';
import { installPathDiagnostics } from './diagnostics.ts';
export {
  diagnoseReadFailure,
  installPathDiagnostics,
  type PathDiagnostic,
  type PathDiagnosticEvent,
  type PathDiagnosticsOptions,
  type PathDiagnosticsRuntimeContext,
} from './diagnostics.ts';

export {
  DEFAULT_PATH_DIAGNOSTIC_CONFIG,
  Config,
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
  ctx: import('./diagnostics.ts').PathDiagnosticsRuntimeContext,
  config: PathDiagnosticConfig = DEFAULT_PATH_DIAGNOSTIC_CONFIG,
): void {
  if (ctx.effect) {
    ctx.effect(() => installPathDiagnostics(ctx, config), 'dsh-path-diagnostics: dispose post-execute observer');
  } else {
    installPathDiagnostics(ctx, config);
  }
}

export default apply;
