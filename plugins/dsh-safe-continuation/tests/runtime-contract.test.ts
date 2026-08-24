import test from 'node:test';
import assert from 'node:assert/strict';

test('dsh-safe-continuation loader contract is wired through the package manifest', async () => {
  const mod = await import('../src/index.ts');
  const manifest = (await import('../package.json', { with: { type: 'json' } })).default as {
    exports?: Record<string, string | { default?: string }>;
    dsh?: {
      bundle?: {
        patch?: string;
      };
    };
  };

  assert.equal(typeof mod.load, 'function');
  assert.equal(manifest.exports?.['.'], './src/index.ts');
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
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

test('dsh-safe-continuation runtime adapter accepts the inspected event shape', async () => {
  const { isSafeContinuationEnvelope } = await import('../src/runtime-types.ts');

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
        data: {
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
          contextWindow: 64000,
        },
      },
    }),
    true,
  );
});
