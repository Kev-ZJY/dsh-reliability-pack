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
//#region src/diagnostics.d.ts
type Disposable = () => void;
type PathDiagnostic = {
  readonly kind: 'dsh-path-diagnostics';
  readonly requestedPath: string;
  readonly candidate: string;
  readonly instruction: 're-read the file explicitly before editing or continuing';
};
type ToolFailure = {
  readonly message?: unknown;
  readonly info?: {
    readonly code?: unknown;
  };
  readonly code?: unknown;
};
type ToolResult = {
  readonly isError?: unknown;
  readonly error?: ToolFailure;
};
type ToolExec = {
  readonly name?: unknown;
  readonly arguments?: unknown;
  readonly signal?: AbortSignal;
  readonly agent?: {
    readonly session?: {
      readonly header?: {
        readonly cwd?: unknown;
      };
    };
  };
};
type FileSystem = {
  readonly resolve?: (path: string, options?: {
    cwd?: string;
    signal?: AbortSignal;
  }) => Promise<unknown>;
  readonly processPath?: (target: unknown) => string;
  readonly lstat?: (path: string, options?: {
    cwd?: string;
  }, signal?: AbortSignal) => Promise<{
    readonly type?: unknown;
  } | undefined>;
  readonly listDir?: (target: unknown, signal?: AbortSignal) => Promise<ReadonlyArray<{
    readonly name?: unknown;
    readonly type?: unknown;
    readonly target?: unknown;
  }>>;
};
type PathDiagnosticEvent = {
  readonly exec: ToolExec;
  readonly result: ToolResult;
  readonly fs?: FileSystem;
  readonly config?: PathDiagnosticConfig;
};
type PathDiagnosticsRuntimeContext = {
  readonly fs?: FileSystem;
  readonly effect?: (factory: () => Disposable | Promise<void> | (() => Promise<void>), label?: string) => unknown;
  on?: (eventName: 'tools/post-execute', listener: (exec: ToolExec, result: Readonly<ToolResult>, next: () => Promise<unknown>) => Promise<unknown>, options?: {
    prepend?: boolean;
  }) => unknown;
};
type PathDiagnosticsOptions = PathDiagnosticConfig & {
  readonly onDiagnostic?: (diagnostic: PathDiagnostic) => void;
};
declare function diagnoseReadFailure(event: PathDiagnosticEvent, fallbackConfig?: PathDiagnosticConfig): Promise<PathDiagnostic | undefined>;
declare function installPathDiagnostics(ctx: PathDiagnosticsRuntimeContext, options?: PathDiagnosticsOptions): Disposable;
//#endregion
//#region src/path-safety.d.ts
declare function normalizeWorkspaceRoot(root: string): string | undefined;
declare function normalizeContainedPath(root: string, candidate: string): string | undefined;
declare function isWithinWorkspace(root: string, candidate: string): boolean;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-path-diagnostics";
declare function apply(ctx: PathDiagnosticsRuntimeContext, config?: PathDiagnosticConfig): void;
//#endregion
export { DEFAULT_PATH_DIAGNOSTIC_CONFIG, type PathDiagnostic, type PathDiagnosticConfig, type PathDiagnosticEvent, type PathDiagnosticsOptions, type PathDiagnosticsRuntimeContext, type ReadOnlySearchAdapter, type SearchDirectoryEntry, type SearchPathMetadata, type SearchResult, apply, apply as default, diagnoseReadFailure, installPathDiagnostics, isWithinWorkspace, name, normalizeContainedPath, normalizeWorkspaceRoot, searchUniqueCandidate };