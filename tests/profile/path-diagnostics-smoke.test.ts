import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

type FileEntry = {
  name: string;
  type: 'file' | 'directory';
  target: string;
};

type FileNode = {
  type: 'file' | 'directory';
  entries?: FileEntry[];
};

type Diagnostic = {
  kind: 'dsh-path-diagnostics';
  requestedPath: string;
  candidate: string;
  instruction: 're-read the file explicitly before editing or continuing';
};

type ToolExec = {
  name: string;
  arguments: { file_path: string };
  signal: AbortSignal;
  agent: { session: { header: { cwd: string } } };
};

type ToolResult = {
  isError: boolean;
  error?: { info?: { code?: string }; message?: string };
};

type PostExecuteListener = (
  exec: ToolExec,
  result: ToolResult,
  next: () => Promise<unknown>,
) => Promise<unknown>;

type FileSystem = ReturnType<typeof createFileSystem>;

type BundleConfig = {
  enabled: boolean;
  readOnly: true;
  maxDepth: number;
  maxCandidates: number;
  maxSearchEntries: number;
  suggestOnlyWhenUnique: true;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
};

type ProfileContext = {
  fs: FileSystem;
  on: (
    eventName: 'tools/post-execute',
    listener: PostExecuteListener,
    options?: { prepend?: boolean },
  ) => () => void;
  effect: (
    factory: () => (() => void) | Promise<void> | (() => Promise<void>),
    label?: string,
  ) => unknown;
};

type PathDiagnosticsBundle = {
  apply(ctx: ProfileContext, config?: BundleConfig): void;
};

function createFileSystem(nodes: Record<string, FileNode>) {
  let writes = 0;

  return {
    get writes() {
      return writes;
    },
    async resolve(path: string) {
      return path;
    },
    processPath(target: unknown) {
      return String(target);
    },
    async lstat(path: string) {
      const node = nodes[path];
      return node ? { type: node.type } : undefined;
    },
    async listDir(target: unknown) {
      return nodes[String(target)]?.entries ?? [];
    },
    async writeText() {
      writes += 1;
      throw new Error('profile smoke must not write while diagnosing');
    },
    async editText() {
      writes += 1;
      throw new Error('profile smoke must not edit while diagnosing');
    },
  };
}

function createProfileFixture(nodes: Record<string, FileNode>) {
  const fs = createFileSystem(nodes);
  let listener: PostExecuteListener | undefined;
  const cleanups: Array<() => void> = [];

  const ctx: ProfileContext = {
    fs,
    on(_eventName, candidate) {
      listener = candidate;
      return () => {
        if (listener === candidate) listener = undefined;
      };
    },
    effect(factory) {
      const cleanup = factory();
      if (typeof cleanup === 'function') {
        cleanups.push(() => {
          void cleanup();
        });
      }
      return cleanup;
    },
  };

  return {
    ctx,
    fs,
    async emit(exec: ToolExec, result: ToolResult, decision: unknown) {
      return listener ? listener(exec, result, async () => decision) : decision;
    },
    async dispose() {
      while (cleanups.length > 0) cleanups.pop()?.();
    },
  };
}

function createExec(cwd: string, filePath: string): ToolExec {
  return {
    name: 'read',
    arguments: { file_path: filePath },
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } },
  };
}

function missingRead(): ToolResult {
  return {
    isError: true,
    error: { info: { code: 'FS_NOT_FOUND' }, message: 'requested path was not found' },
  };
}

function config(onDiagnostic: (diagnostic: Diagnostic) => void): BundleConfig {
  return {
    enabled: true,
    readOnly: true,
    maxDepth: 4,
    maxCandidates: 8,
    maxSearchEntries: 2000,
    suggestOnlyWhenUnique: true,
    onDiagnostic,
  };
}

async function loadPublishedBundle(): Promise<PathDiagnosticsBundle> {
  return import('../../plugins/dsh-path-diagnostics/lib/index.js');
}

test('profile patch mounts an optional path diagnostics bundle disabled by default', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../../plugins/dsh-path-diagnostics/package.json', import.meta.url), 'utf8'),
  ) as { dsh?: { bundle?: { patch?: string } }; files?: string[] };
  const patch = await readFile(
    new URL('../../plugins/dsh-path-diagnostics/cordis.patch.yml', import.meta.url),
    'utf8',
  );

  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.deepEqual(manifest.files, ['lib', 'cordis.patch.yml', 'README.md', 'README.zh.md']);
  assert.match(patch, /id: path-diagnostics/);
  assert.match(patch, /name: dsh-path-diagnostics/);
  assert.match(patch, /enabled: false/);
  assert.match(patch, /readOnly: true/);
});

test('unique candidate emits a sidecar while the original post-execute decision stays unchanged', async () => {
  const root = '/workspace/project';
  const nodes: Record<string, FileNode> = {
    [root]: {
      type: 'directory',
      entries: [
        { name: 'src', type: 'directory', target: `${root}/src` },
        { name: 'assembly', type: 'directory', target: `${root}/assembly` },
      ],
    },
    [`${root}/src`]: {
      type: 'directory',
      entries: [{ name: 'components', type: 'directory', target: `${root}/src/components` }],
    },
    [`${root}/src/components`]: { type: 'directory', entries: [] },
    [`${root}/assembly`]: {
      type: 'directory',
      entries: [{ name: 'SubtitlePlayer.tsx', type: 'file', target: `${root}/assembly/SubtitlePlayer.tsx` }],
    },
    [`${root}/assembly/SubtitlePlayer.tsx`]: { type: 'file' },
  };
  const fixture = createProfileFixture(nodes);
  const diagnostics: Diagnostic[] = [];
  const bundle = await loadPublishedBundle();
  bundle.apply(fixture.ctx, config((diagnostic) => diagnostics.push(diagnostic)));

  const decision = { kind: 'reject', reason: 'original FS_NOT_FOUND decision' };
  const returned = await fixture.emit(
    createExec(root, `${root}/src/components/SubtitlePlayer.tsx`),
    missingRead(),
    decision,
  );

  assert.equal(returned, decision);
  assert.deepEqual(diagnostics, [{
    kind: 'dsh-path-diagnostics',
    requestedPath: `${root}/src/components/SubtitlePlayer.tsx`,
    candidate: `${root}/assembly/SubtitlePlayer.tsx`,
    instruction: 're-read the file explicitly before editing or continuing',
  }]);
  assert.equal(fixture.fs.writes, 0);
  await fixture.dispose();
});

test('ambiguous candidates produce no selected candidate and disposal removes the observer', async () => {
  const root = '/workspace/project';
  const nodes: Record<string, FileNode> = {
    [root]: {
      type: 'directory',
      entries: [
        { name: 'one', type: 'directory', target: `${root}/one` },
        { name: 'two', type: 'directory', target: `${root}/two` },
      ],
    },
    [`${root}/one`]: {
      type: 'directory',
      entries: [{ name: 'Target.ts', type: 'file', target: `${root}/one/Target.ts` }],
    },
    [`${root}/two`]: {
      type: 'directory',
      entries: [{ name: 'Target.ts', type: 'file', target: `${root}/two/Target.ts` }],
    },
    [`${root}/one/Target.ts`]: { type: 'file' },
    [`${root}/two/Target.ts`]: { type: 'file' },
  };
  const fixture = createProfileFixture(nodes);
  const diagnostics: Diagnostic[] = [];
  const bundle = await loadPublishedBundle();
  bundle.apply(fixture.ctx, config((diagnostic) => diagnostics.push(diagnostic)));

  const ambiguousDecision = { kind: 'accept', reason: 'ambiguous original decision' };
  const ambiguousResult = await fixture.emit(
    createExec(root, `${root}/missing/Target.ts`),
    missingRead(),
    ambiguousDecision,
  );

  assert.equal(ambiguousResult, ambiguousDecision);
  assert.deepEqual(diagnostics, []);

  await fixture.dispose();
  const disposedDecision = { kind: 'accept', reason: 'disposed original decision' };
  const disposedResult = await fixture.emit(
    createExec(root, `${root}/missing/Target.ts`),
    missingRead(),
    disposedDecision,
  );

  assert.equal(disposedResult, disposedDecision);
  assert.deepEqual(diagnostics, []);
  assert.equal(fixture.fs.writes, 0);
});
