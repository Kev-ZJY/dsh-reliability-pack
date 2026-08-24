import {
  DEFAULT_PATH_DIAGNOSTIC_CONFIG,
  searchUniqueCandidate,
  type PathDiagnosticConfig,
  type ReadOnlySearchAdapter,
} from './search.ts';

type Disposable = () => void;

export type PathDiagnostic = {
  readonly kind: 'dsh-path-diagnostics';
  readonly requestedPath: string;
  readonly candidate: string;
  readonly instruction: 're-read the file explicitly before editing or continuing';
};

type ToolFailure = {
  readonly message?: unknown;
  readonly info?: { readonly code?: unknown };
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
      readonly header?: { readonly cwd?: unknown };
    };
  };
};

type FileSystem = {
  readonly resolve?: (path: string, options?: { cwd?: string; signal?: AbortSignal }) => Promise<unknown>;
  readonly processPath?: (target: unknown) => string;
  readonly lstat?: (
    path: string,
    options?: { cwd?: string },
    signal?: AbortSignal,
  ) => Promise<{ readonly type?: unknown } | undefined>;
  readonly listDir?: (
    target: unknown,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<{ readonly name?: unknown; readonly type?: unknown; readonly target?: unknown }>>;
};

export type PathDiagnosticEvent = {
  readonly exec: ToolExec;
  readonly result: ToolResult;
  readonly fs?: FileSystem;
  readonly config?: PathDiagnosticConfig;
};

export type PathDiagnosticsRuntimeContext = {
  readonly fs?: FileSystem;
  readonly effect?: (factory: () => Disposable | Promise<void> | (() => Promise<void>), label?: string) => unknown;
  on?: (
    eventName: 'tools/post-execute',
    listener: (
      exec: ToolExec,
      result: Readonly<ToolResult>,
      next: () => Promise<unknown>,
    ) => Promise<unknown>,
    options?: { prepend?: boolean },
  ) => unknown;
};

export type PathDiagnosticsOptions = PathDiagnosticConfig & {
  readonly onDiagnostic?: (diagnostic: PathDiagnostic) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined;
}

function requestedPathOf(exec: ToolExec): string | undefined {
  if (!isRecord(exec.arguments)) return undefined;
  return stringField(exec.arguments, 'file_path') ?? stringField(exec.arguments, 'path');
}

function errorCodeOf(result: ToolResult): string | undefined {
  if (result.isError !== true || !result.error) return undefined;
  return stringField(result.error.info, 'code') ?? stringField(result.error, 'code');
}

function workspaceOf(exec: ToolExec): string | undefined {
  const cwd = exec.agent?.session?.header?.cwd;
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined;
}

function adapterFor(fs: FileSystem, cwd: string, signal?: AbortSignal): ReadOnlySearchAdapter | undefined {
  if (!fs.resolve || !fs.processPath || !fs.lstat || !fs.listDir) return undefined;
  return {
    async lstat(path, childSignal) {
      const metadata = await fs.lstat?.(path, { cwd }, childSignal ?? signal);
      if (!metadata || typeof metadata.type !== 'string') return undefined;
      return { type: metadata.type as 'file' | 'directory' | 'symlink' | 'other' };
    },
    async listDir(path, childSignal) {
      const target = await fs.resolve?.(path, { cwd, signal: childSignal ?? signal });
      if (target === undefined) throw new Error('path could not be resolved');
      const entries = await fs.listDir?.(target, childSignal ?? signal);
      if (!entries) throw new Error('directory could not be listed');
      return entries.flatMap((entry) => {
        const name = entry.name;
        const childTarget = entry.target;
        if (typeof name !== 'string' || childTarget === undefined) return [];
        const childPath = fs.processPath?.(childTarget);
        if (typeof childPath !== 'string') return [];
        const type = entry.type === 'file' || entry.type === 'directory' ? entry.type : 'other';
        return [{ name, path: childPath, type }];
      });
    },
  };
}

export async function diagnoseReadFailure(
  event: PathDiagnosticEvent,
  fallbackConfig: PathDiagnosticConfig = DEFAULT_PATH_DIAGNOSTIC_CONFIG,
): Promise<PathDiagnostic | undefined> {
  if (event.exec.name !== 'read' || errorCodeOf(event.result) !== 'FS_NOT_FOUND') return undefined;
  const requestedPath = requestedPathOf(event.exec);
  const cwd = workspaceOf(event.exec);
  const fs = event.fs;
  if (!requestedPath || !cwd || !fs) return undefined;
  const config = event.config ?? fallbackConfig;
  const adapter = adapterFor(fs, cwd, event.exec.signal);
  if (!adapter) return undefined;
  const result = await searchUniqueCandidate(cwd, requestedPath, config, adapter, event.exec.signal);
  if (!('candidate' in result)) return undefined;
  return {
    kind: 'dsh-path-diagnostics',
    requestedPath,
    candidate: result.candidate,
    instruction: 're-read the file explicitly before editing or continuing',
  };
}

function toDisposable(value: unknown): Disposable {
  return typeof value === 'function' ? () => value() : () => {};
}

export function installPathDiagnostics(
  ctx: PathDiagnosticsRuntimeContext,
  options: PathDiagnosticsOptions = DEFAULT_PATH_DIAGNOSTIC_CONFIG,
): Disposable {
  const unsubscribe = toDisposable(ctx.on?.('tools/post-execute', async (exec, result, next) => {
    if (options.enabled) {
      try {
        const diagnostic = await diagnoseReadFailure({ exec, result, fs: ctx.fs, config: options });
        if (diagnostic) options.onDiagnostic?.(diagnostic);
      } catch {
        // Diagnostics are strictly best effort; the original tool decision remains authoritative.
      }
    }
    return next();
  }, { prepend: true }));
  return unsubscribe;
}
