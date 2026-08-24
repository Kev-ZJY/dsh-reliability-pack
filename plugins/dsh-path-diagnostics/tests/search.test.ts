import test from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';

type ListedType = 'file' | 'directory' | 'other';
type PathType = ListedType | 'symlink';

type SearchResult = { candidate: string } | { reason: string };
type SearchConfig = {
  enabled: boolean;
  readOnly: true;
  maxDepth: number;
  maxCandidates: number;
  maxSearchEntries: number;
  suggestOnlyWhenUnique: true;
};

type SearchAdapter = {
  listDir(path: string, signal?: AbortSignal): Promise<
    ReadonlyArray<{ name: string; path: string; type: ListedType }>
  >;
  lstat(path: string, signal?: AbortSignal): Promise<{ type: PathType } | undefined>;
};

type Node = {
  type: PathType;
  children?: string[];
  listedType?: ListedType;
};

class MemoryReadOnlyAdapter implements SearchAdapter {
  readonly listCalls: string[] = [];
  readonly lstatCalls: string[] = [];
  private readonly nodes: Readonly<Record<string, Node>>;
  private readonly beforeList?: (path: string) => void;

  constructor(
    nodes: Readonly<Record<string, Node>>,
    beforeList?: (path: string) => void,
  ) {
    this.nodes = nodes;
    this.beforeList = beforeList;
  }

  async listDir(path: string, signal?: AbortSignal) {
    this.listCalls.push(path);
    this.beforeList?.(path);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const node = this.nodes[path];
    if (!node || node.type !== 'directory') throw new Error(`not a directory: ${path}`);

    return (node.children ?? []).map((childPath) => {
      const child = this.nodes[childPath];
      assert.ok(child, `fixture is missing ${childPath}`);
      return {
        name: basename(childPath),
        path: childPath,
        type: child.listedType ?? (child.type === 'directory' ? 'directory' : child.type === 'file' ? 'file' : 'other'),
      };
    });
  }

  async lstat(path: string, signal?: AbortSignal) {
    this.lstatCalls.push(path);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const node = this.nodes[path];
    return node === undefined ? undefined : { type: node.type };
  }
}

function directory(...children: string[]): Node {
  return { type: 'directory', children };
}

function file(): Node {
  return { type: 'file' };
}

function symlink(...listedChildren: string[]): Node {
  return { type: 'symlink', children: listedChildren, listedType: 'directory' };
}

function config(overrides: Partial<SearchConfig> = {}): SearchConfig {
  return {
    enabled: true,
    readOnly: true,
    maxDepth: 4,
    maxCandidates: 8,
    maxSearchEntries: 2000,
    suggestOnlyWhenUnique: true,
    ...overrides,
  };
}

async function loadSearch(): Promise<
  (root: string, requestedPath: string, config: SearchConfig, adapter: SearchAdapter, signal?: AbortSignal) => Promise<SearchResult>
> {
  const module = await import('../src/search.ts').catch(() => ({} as typeof import('../src/search.ts')));
  assert.equal(typeof module.searchUniqueCandidate, 'function');
  return module.searchUniqueCandidate;
}

test('finds one unique same-basename file without reading file contents', async () => {
  const root = '/workspace';
  const nodes: Record<string, Node> = {
    [root]: directory(`${root}/frontend-beidou`, `${root}/src`),
    [`${root}/frontend-beidou`]: directory(`${root}/frontend-beidou/assembly`),
    [`${root}/frontend-beidou/assembly`]: directory(`${root}/frontend-beidou/assembly/SubtitlePlayer.tsx`),
    [`${root}/frontend-beidou/assembly/SubtitlePlayer.tsx`]: file(),
    [`${root}/src`]: directory(`${root}/src/components`),
    [`${root}/src/components`]: directory(`${root}/src/components/assembly`),
    [`${root}/src/components/assembly`]: directory(),
  };
  const adapter = new MemoryReadOnlyAdapter(nodes);
  const searchUniqueCandidate = await loadSearch();

  const result = await searchUniqueCandidate(
    root,
    `${root}/src/components/assembly/SubtitlePlayer.tsx`,
    config(),
    adapter,
    new AbortController().signal,
  );

  assert.deepEqual(result, { candidate: `${root}/frontend-beidou/assembly/SubtitlePlayer.tsx` });
  assert.equal('readText' in adapter, false);
  assert.equal('writeText' in adapter, false);
});

test('returns no-match when the basename does not occur', async () => {
  const root = '/workspace';
  const nodes: Record<string, Node> = {
    [root]: directory(`${root}/src`),
    [`${root}/src`]: directory(),
  };
  const result = await (await loadSearch())(
    root,
    `${root}/src/Missing.tsx`,
    config(),
    new MemoryReadOnlyAdapter(nodes),
  );

  assert.deepEqual(result, { reason: 'no-match' });
});

test('returns multiple-matches instead of choosing among candidates', async () => {
  const root = '/workspace';
  const nodes: Record<string, Node> = {
    [root]: directory(`${root}/one`, `${root}/two`),
    [`${root}/one`]: directory(`${root}/one/Target.ts`),
    [`${root}/one/Target.ts`]: file(),
    [`${root}/two`]: directory(`${root}/two/Target.ts`),
    [`${root}/two/Target.ts`]: file(),
  };
  const result = await (await loadSearch())(
    root,
    `${root}/Target.ts`,
    config(),
    new MemoryReadOnlyAdapter(nodes),
  );

  assert.deepEqual(result, { reason: 'multiple-matches' });
});

test('stops with missing-parent when the requested parent is absent', async () => {
  const root = '/workspace';
  const nodes: Record<string, Node> = { [root]: directory() };
  const result = await (await loadSearch())(
    root,
    `${root}/missing/Target.ts`,
    config(),
    new MemoryReadOnlyAdapter(nodes),
  );

  assert.deepEqual(result, { reason: 'missing-parent' });
});

test('does not search beyond maxDepth', async () => {
  const root = '/workspace';
  const nodes: Record<string, Node> = {
    [root]: directory(`${root}/level-one`),
    [`${root}/level-one`]: directory(`${root}/level-one/level-two`),
    [`${root}/level-one/level-two`]: directory(`${root}/level-one/level-two/Target.ts`),
    [`${root}/level-one/level-two/Target.ts`]: file(),
  };
  const result = await (await loadSearch())(
    root,
    `${root}/level-one/level-two/Target.ts`,
    config({ maxDepth: 1 }),
    new MemoryReadOnlyAdapter(nodes),
  );

  assert.deepEqual(result, { reason: 'no-match' });
});

test('fails closed when maxSearchEntries would be exceeded', async () => {
  const root = '/workspace';
  const nodes: Record<string, Node> = {
    [root]: directory(`${root}/a`, `${root}/b`),
    [`${root}/a`]: directory(`${root}/a/Target.ts`),
    [`${root}/a/Target.ts`]: file(),
    [`${root}/b`]: directory(),
  };
  const result = await (await loadSearch())(
    root,
    `${root}/Target.ts`,
    config({ maxSearchEntries: 1 }),
    new MemoryReadOnlyAdapter(nodes),
  );

  assert.deepEqual(result, { reason: 'search-entry-cap' });
});

test('returns aborted when the adapter is cancelled during traversal', async () => {
  const root = '/workspace';
  const controller = new AbortController();
  const nodes: Record<string, Node> = { [root]: directory() };
  const adapter = new MemoryReadOnlyAdapter(nodes, () => controller.abort());
  const result = await (await loadSearch())(
    root,
    `${root}/Target.ts`,
    config(),
    adapter,
    controller.signal,
  );

  assert.deepEqual(result, { reason: 'aborted' });
});

test('does not follow a symlinked directory that could escape the workspace', async () => {
  const root = '/workspace';
  const nodes: Record<string, Node> = {
    [root]: directory(`${root}/linked-source`),
    [`${root}/linked-source`]: symlink(`${root}/linked-source/Target.ts`),
    [`${root}/linked-source/Target.ts`]: file(),
  };
  const adapter = new MemoryReadOnlyAdapter(nodes);
  const result = await (await loadSearch())(
    root,
    `${root}/Target.ts`,
    config(),
    adapter,
  );

  assert.deepEqual(result, { reason: 'no-match' });
  assert.equal(adapter.listCalls.includes(`${root}/linked-source`), false);
  assert.equal(adapter.lstatCalls.includes(`${root}/linked-source`), true);
});

test('rejects a requested path outside the workspace before traversal', async () => {
  const root = '/workspace';
  const adapter = new MemoryReadOnlyAdapter({ [root]: directory() });
  const result = await (await loadSearch())(
    root,
    '/outside/Target.ts',
    config(),
    adapter,
  );

  assert.deepEqual(result, { reason: 'outside-workspace' });
  assert.deepEqual(adapter.listCalls, []);
});
