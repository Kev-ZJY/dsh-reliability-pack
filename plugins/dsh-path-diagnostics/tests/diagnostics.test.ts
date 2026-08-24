import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apply,
  diagnoseReadFailure,
  installPathDiagnostics,
  type PathDiagnosticsRuntimeContext,
} from '../src/index.ts';

type Entry = { name: string; type: 'file' | 'directory'; target: string };

function createFs(nodes: Record<string, { type: 'file' | 'directory'; entries?: Entry[] }>) {
  let writes = 0;
  return {
    get writes() { return writes; },
    async resolve(path: string) { return path; },
    processPath(target: unknown) { return String(target); },
    async lstat(path: string) {
      const node = nodes[path];
      return node ? { type: node.type } : undefined;
    },
    async listDir(target: unknown) {
      return nodes[String(target)]?.entries ?? [];
    },
    async writeText() { writes += 1; throw new Error('write must not be called'); },
    async editText() { writes += 1; throw new Error('edit must not be called'); },
  };
}

function uniqueFixture() {
  const root = '/workspace';
  const nodes = {
    [root]: { type: 'directory' as const, entries: [
      { name: 'src', type: 'directory' as const, target: `${root}/src` },
      { name: 'other', type: 'directory' as const, target: `${root}/other` },
    ] },
    [`${root}/src`]: { type: 'directory' as const, entries: [] },
    [`${root}/other`]: { type: 'directory' as const, entries: [
      { name: 'SubtitlePlayer.tsx', type: 'file' as const, target: `${root}/other/SubtitlePlayer.tsx` },
    ] },
    [`${root}/other/SubtitlePlayer.tsx`]: { type: 'file' as const },
  };
  return { root, nodes };
}

function exec(name: string, filePath: string) {
  return {
    name,
    arguments: { file_path: filePath },
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: '/workspace' } } },
  };
}

function result(code?: string) {
  return code
    ? { isError: true as const, error: { info: { code }, message: 'cannot read requested path' } }
    : { isError: false as const, value: {}, content: [] };
}

test('diagnoses one structured missing read and keeps the post-execute decision unchanged', async () => {
  const { root, nodes } = uniqueFixture();
  const fs = createFs(nodes);
  const diagnostics: unknown[] = [];
  const listeners: Array<(...args: any[]) => Promise<unknown>> = [];
  const ctx: PathDiagnosticsRuntimeContext & { fs: typeof fs } = {
    fs,
    on(_event, listener) {
      listeners.unshift(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  };
  installPathDiagnostics(ctx, {
    enabled: true,
    readOnly: true,
    maxDepth: 4,
    maxCandidates: 8,
    maxSearchEntries: 2000,
    suggestOnlyWhenUnique: true,
    onDiagnostic(value) { diagnostics.push(value); },
  });

  const decision = { kind: 'accept' };
  const returned = await listeners[0](exec('read', `${root}/src/SubtitlePlayer.tsx`), result('FS_NOT_FOUND'), async () => decision);

  assert.equal(returned, decision);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0], {
    kind: 'dsh-path-diagnostics',
    requestedPath: `${root}/src/SubtitlePlayer.tsx`,
    candidate: `${root}/other/SubtitlePlayer.tsx`,
    instruction: 're-read the file explicitly before editing or continuing',
  });
  assert.equal(fs.writes, 0);
});

test('does not select ambiguous candidates or diagnose non-read and non-structured failures', async () => {
  const root = '/workspace';
  const nodes = {
    [root]: { type: 'directory' as const, entries: [
      { name: 'one', type: 'directory' as const, target: `${root}/one` },
      { name: 'two', type: 'directory' as const, target: `${root}/two` },
    ] },
    [`${root}/one`]: { type: 'directory' as const, entries: [{ name: 'Target.ts', type: 'file' as const, target: `${root}/one/Target.ts` }] },
    [`${root}/two`]: { type: 'directory' as const, entries: [{ name: 'Target.ts', type: 'file' as const, target: `${root}/two/Target.ts` }] },
    [`${root}/one/Target.ts`]: { type: 'file' as const },
    [`${root}/two/Target.ts`]: { type: 'file' as const },
  };
  const fs = createFs(nodes);
  const diagnostics: unknown[] = [];
  let listener!: (...args: any[]) => Promise<unknown>;
  const ctx: PathDiagnosticsRuntimeContext & { fs: typeof fs } = {
    fs,
    on(_event, candidate) { listener = candidate; return () => {}; },
  };
  installPathDiagnostics(ctx, {
    enabled: true, readOnly: true, maxDepth: 4, maxCandidates: 8,
    maxSearchEntries: 2000, suggestOnlyWhenUnique: true,
    onDiagnostic(value) { diagnostics.push(value); },
  });
  const next = async () => ({ kind: 'accept' });
  await listener(exec('read', `${root}/missing/Target.ts`), result('FS_NOT_FOUND'), next);
  await listener(exec('read', `${root}/Target.ts`), result(), next);
  await listener(exec('write', `${root}/Target.ts`), result('FS_NOT_FOUND'), next);
  await listener(exec('read', `${root}/Target.ts`), { isError: true, error: { message: 'cannot read "...": not found' } }, next);
  assert.deepEqual(diagnostics, []);
  assert.equal(fs.writes, 0);
});

test('apply registers the verified post-execute hook through the lifecycle effect', async () => {
  let effectCalled = false;
  let onCalled = false;
  const ctx: PathDiagnosticsRuntimeContext = {
    effect(factory) {
      effectCalled = true;
      factory();
    },
    on(eventName) {
      onCalled = eventName === 'tools/post-execute';
      return () => {};
    },
  };
  apply(ctx, { enabled: false, readOnly: true, maxDepth: 4, maxCandidates: 8, maxSearchEntries: 2000, suggestOnlyWhenUnique: true });
  assert.equal(effectCalled, true);
  assert.equal(onCalled, true);
});

test('direct diagnosis is fail-closed without filesystem read or mutation methods', async () => {
  const { root, nodes } = uniqueFixture();
  const fs = createFs(nodes);
  const diagnostic = await diagnoseReadFailure({
    exec: exec('read', `${root}/src/SubtitlePlayer.tsx`),
    result: result('FS_NOT_FOUND'),
    fs,
  }, {
    enabled: true, readOnly: true, maxDepth: 4, maxCandidates: 8,
    maxSearchEntries: 2000, suggestOnlyWhenUnique: true,
  });
  assert.equal(diagnostic?.candidate, `${root}/other/SubtitlePlayer.tsx`);
  assert.equal(fs.writes, 0);
});

