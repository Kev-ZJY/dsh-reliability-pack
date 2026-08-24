//#region src/search.d.ts
type PathDiagnosticConfig = {
  enabled: boolean;
  readOnly: true;
  maxDepth: number;
  maxCandidates: number;
  maxSearchEntries: number;
  suggestOnlyWhenUnique: true;
};
type SearchDirectoryEntry = {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'directory' | 'other';
};
type SearchPathMetadata = {
  readonly type: 'file' | 'directory' | 'symlink' | 'other';
};
type ReadOnlySearchAdapter = {
  readonly listDir: (path: string, signal?: AbortSignal) => Promise<ReadonlyArray<SearchDirectoryEntry>>;
  readonly lstat: (path: string, signal?: AbortSignal) => Promise<SearchPathMetadata | undefined>;
};
type SearchResult = {
  candidate: string;
} | {
  reason: string;
};
declare const DEFAULT_PATH_DIAGNOSTIC_CONFIG: PathDiagnosticConfig;
declare function searchUniqueCandidate(root: string, requestedPath: string, config: PathDiagnosticConfig, adapter: ReadOnlySearchAdapter, signal?: AbortSignal): Promise<SearchResult>;
//#endregion
//#region src/path-safety.d.ts
declare function normalizeWorkspaceRoot(root: string): string | undefined;
declare function normalizeContainedPath(root: string, candidate: string): string | undefined;
declare function isWithinWorkspace(root: string, candidate: string): boolean;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-path-diagnostics";
declare function apply(_ctx: unknown, _config?: PathDiagnosticConfig): void;
//#endregion
export { DEFAULT_PATH_DIAGNOSTIC_CONFIG, type PathDiagnosticConfig, type ReadOnlySearchAdapter, type SearchDirectoryEntry, type SearchPathMetadata, type SearchResult, apply, apply as default, isWithinWorkspace, name, normalizeContainedPath, normalizeWorkspaceRoot, searchUniqueCandidate };