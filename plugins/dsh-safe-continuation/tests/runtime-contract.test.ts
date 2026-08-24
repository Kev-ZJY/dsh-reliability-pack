import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const builtLoaderPath = new URL('../lib/index.js', import.meta.url);
const builtRuntimeTypesPath = new URL('../lib/runtime-types.js', import.meta.url);

test('dsh-safe-continuation loader contract is wired through the package manifest', async () => {
  const mod = await import('../src/index.ts');
  const manifest = (await import('../package.json', { with: { type: 'json' } })).default as {
    exports?: Record<string, string | { default?: string }>;
    files?: string[];
    dsh?: {
      bundle?: {
        patch?: string;
      };
    };
  };

  assert.equal(mod.name, 'dsh-safe-continuation');
  assert.equal(typeof mod.apply, 'function');
  assert.equal(manifest.exports?.['.'], './lib/index.js');
  assert.equal(manifest.exports?.['./runtime-types'], './lib/runtime-types.js');
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.deepEqual(manifest.files, ['lib', 'cordis.patch.yml', 'README.md', 'README.zh.md']);

  await access(builtLoaderPath);
  await access(builtRuntimeTypesPath);

  const builtLoader = await import(pathToFileURL(builtLoaderPath.pathname).href);
  const builtRuntimeTypes = await import(pathToFileURL(builtRuntimeTypesPath.pathname).href);

  assert.equal(builtLoader.name, 'dsh-safe-continuation');
  assert.equal(typeof builtLoader.apply, 'function');
  assert.equal(typeof builtRuntimeTypes.isSafeContinuationRequestContext, 'function');
});

test('dsh-safe-continuation package manifest forbids install-time build scripts', async () => {
  const manifest = (await import('../package.json', { with: { type: 'json' } })).default as {
    scripts?: Record<string, string>;
  };
  const forbiddenScripts = ['build', 'prepare', 'prepack', 'preinstall', 'install', 'postinstall'];

  for (const scriptName of forbiddenScripts) {
    assert.equal(scriptName in (manifest.scripts ?? {}), false, `unexpected ${scriptName} script`);
  }
});

test('published declarations reference only existing package-local files', async () => {
  const declarationPath = new URL('../lib/index.d.ts', import.meta.url);
  const declaration = await readFile(declarationPath, 'utf8');
  const relativeTargets = [...declaration.matchAll(/(?:from\s+|import\(\s*)['"](\.[^'"]+)['"]/g)].map(
    ([, target]) => target,
  );

  assert.doesNotMatch(declaration, /\.(?:mjs|mts)(?:['"]|\b)/);

  for (const target of relativeTargets) {
    await access(new URL(target, declarationPath));
  }
});

test('dsh-safe-continuation runtime adapter accepts the inspected event shape', async () => {
  const { isSafeContinuationEnvelope, isSafeContinuationRequestContext } = await import('../src/runtime-types.ts');
  const requestContext = {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    contextWindow: 64000,
  };

  assert.equal(isSafeContinuationRequestContext(requestContext), true);

  assert.equal(
    isSafeContinuationEnvelope({
      session: {
        id: 'session-id',
        header: {
          id: 'session-id',
        },
      },
      event: {
        type: 'request/context',
        seq: 12,
        time: 1724496000000,
        data: requestContext,
      },
    }),
    true,
  );
});

test('dsh-safe-continuation request/context validator rejects invalid payloads', async () => {
  const { isSafeContinuationRequestContext } = await import('../src/runtime-types.ts');

  assert.equal(
    isSafeContinuationRequestContext({
      provider: 'deepseek-official',
      contextWindow: 64000,
    }),
    false,
  );
  assert.equal(
    isSafeContinuationRequestContext({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      contextWindow: '64000',
    }),
    false,
  );
});
