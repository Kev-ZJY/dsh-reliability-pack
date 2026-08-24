import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectTokenMeter } from '../src/inspect-token-meter.ts';

const patchedClampHash = 'dfe44a358807c75edadc5aa4992b798180f0d06be04b1e736f030b924e99bb3f';

test('token-meter report fingerprints the package, versions projection rows, finds negative cache values, and resolves affected sessions read-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doctor-token-meter-'));
  const packageJson = join(root, 'token-meter/package.json');
  const clampSource = join(root, 'token-meter/breakdown-projection.ts');
  const cache = join(root, 'session_projcache.json');
  const sessionRecord = join(root, 'session-affected.jsonl');
  const secret = 'sk-do-not-leak-token-meter';
  const cacheText = JSON.stringify({
    unit: { name: 'session_projcache', version: 3 },
    tables: {
      sessions: {
        'session-affected': {
          rows: {
            contextPressure: { ver: 4, seq: 20, val: { surfaceTokens: -1005, contextWindow: 128000 } },
            contextBreakdown: { ver: 2, seq: 20, val: { messageTokens: -1005 } },
            tokenUsage: { ver: 1, seq: 20, val: { totals: { outputTokens: 10 } } },
          },
        },
        'session-clean': {
          rows: {
            contextBreakdown: { ver: 2, seq: 4, val: { messageTokens: 3 } },
          },
        },
      },
    },
    diagnostics: { accessToken: secret },
  }, null, 2) + '\n';

  try {
    await mkdir(join(root, 'token-meter'), { recursive: true });
    await writeFile(packageJson, '{"name":"@deepseek-ai/dsh-token-meter","version":"0.1.1-rc.2"}\n');
    await writeFile(clampSource, 'export function clamp(value: number): number { return Math.max(0, value); }\n');
    await writeFile(cache, cacheText);
    await writeFile(sessionRecord, [
      JSON.stringify({ type: 'session', id: 'session-affected', cwd: '/workspace/project' }),
      JSON.stringify({ type: 'assistant/message', data: { text: secret } }),
      '',
    ].join('\n'));
    const beforeCache = await readFile(cache, 'utf8');
    const beforeCacheMtime = (await stat(cache)).mtimeMs;

    const report = await inspectTokenMeter({
      packageManifestPath: packageJson,
      fingerprints: [{
        name: 'breakdown-clamp',
        path: clampSource,
        patchedHash: patchedClampHash,
      }],
      cachePaths: [cache],
      sessionRecordPaths: [sessionRecord],
    });

    assert.equal(report.packageVersion, '0.1.1-rc.2');
    assert.deepEqual(report.fingerprints, [{
      name: 'breakdown-clamp',
      path: clampSource,
      hash: patchedClampHash,
      state: 'patched',
    }]);
    assert.deepEqual(report.projectionVersions, [1, 2, 4]);
    assert.deepEqual(report.negativeValues, [
      { sessionId: 'session-affected', projection: 'contextBreakdown', field: 'messageTokens', value: -1005 },
      { sessionId: 'session-affected', projection: 'contextPressure', field: 'surfaceTokens', value: -1005 },
    ]);
    assert.deepEqual(report.affectedSessions, ['session-affected']);
    assert.equal(await readFile(cache, 'utf8'), beforeCache);
    assert.equal((await stat(cache)).mtimeMs, beforeCacheMtime);
    assert.doesNotMatch(JSON.stringify(report), /do-not-leak-token-meter|accessToken|assistant\/message/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing token-meter inputs produce a safe empty report and never discover unrelated paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doctor-token-meter-missing-'));
  try {
    const report = await inspectTokenMeter({
      packageManifestPath: join(root, 'missing-package.json'),
      fingerprints: [{ name: 'missing', path: join(root, 'missing-source.ts'), patchedHash: patchedClampHash }],
      cachePaths: [join(root, 'missing-cache.json')],
      sessionRecordPaths: [join(root, 'missing-session.jsonl')],
    });

    assert.deepEqual(report, {
      fingerprints: [{
        name: 'missing',
        path: join(root, 'missing-source.ts'),
        state: 'missing',
      }],
      projectionVersions: [],
      negativeValues: [],
      affectedSessions: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
