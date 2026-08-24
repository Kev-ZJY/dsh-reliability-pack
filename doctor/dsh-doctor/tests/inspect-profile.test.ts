import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectProfile } from '../src/inspect-profile.ts';

const expectedPluginManifestHash = 'd86e12145714b7b8df6d06c59b440894d149bd6cd00543cd749c40b39eac0dd6';

type ProfileFixture = {
  root: string;
  manifest: string;
  lockfile: string;
  workspace: string;
  patch: string;
  dshPackage: string;
  pluginManifest: string;
};

async function createProfileFixture(): Promise<ProfileFixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doctor-profile-'));
  const manifest = join(root, 'package.json');
  const lockfile = join(root, 'pnpm-lock.yaml');
  const workspace = join(root, 'pnpm-workspace.yaml');
  const patch = join(root, 'cordis.patch.yml');
  const dshPackage = join(root, 'node_modules/@deepseek-ai/dsh/package.json');
  const pluginManifest = join(root, 'node_modules/dsh-safe-continuation/package.json');

  await mkdir(join(root, 'node_modules/@deepseek-ai/dsh'), { recursive: true });
  await mkdir(join(root, 'node_modules/dsh-safe-continuation'), { recursive: true });
  await writeFile(manifest, '{"name":"web","version":"1.0.0","dependencies":{"dsh-safe-continuation":"0.1.0"}}\n');
  await writeFile(lockfile, [
    'lockfileVersion: 9.0',
    'importers:',
    '  .:',
    '    dependencies:',
    '      dsh-safe-continuation:',
    '        specifier: 0.1.0',
    '        version: 0.1.0',
    '',
  ].join('\n'));
  await writeFile(workspace, 'packages:\n  - .\n');
  await writeFile(patch, 'id: safe-continuation\nname: dsh-safe-continuation\n');
  await writeFile(dshPackage, '{"name":"@deepseek-ai/dsh","version":"0.1.1-rc.2"}\n');
  await writeFile(pluginManifest, '{"name":"dsh-safe-continuation","version":"0.1.0"}\n');

  return { root, manifest, lockfile, workspace, patch, dshPackage, pluginManifest };
}

function profileInput(fixture: ProfileFixture) {
  return {
    profilePath: fixture.root,
    manifestPath: fixture.manifest,
    lockfilePath: fixture.lockfile,
    workspacePolicyPath: fixture.workspace,
    cordisPatchPath: fixture.patch,
    dshPackagePath: fixture.dshPackage,
    expectedDshVersion: '0.1.1-rc.2',
    packageChecks: [{
      name: 'dsh-safe-continuation',
      manifestPath: fixture.pluginManifest,
      expectedVersion: '0.1.0',
      expectedHash: expectedPluginManifestHash,
    }],
    runCommand: async () => ({
      exitCode: 0,
      stdout: '{"apiKey":"do-not-leak","accessToken":"also-secret"}',
      stderr: '',
    }),
  };
}

test('clean profile passes package, version, hash, and config checks without leaking command output', async () => {
  const fixture = await createProfileFixture();
  try {
    const result = await inspectProfile(profileInput(fixture));

    assert.equal(result.ok, true);
    assert.ok(result.checks.length >= 7);
    assert.ok(result.checks.every((check) => check.ok));
    assert.equal(result.statusRecord?.dshVersion, '0.1.1-rc.2');
    assert.equal(result.statusRecord?.pluginManifestHashes['dsh-safe-continuation'], expectedPluginManifestHash);
    assert.doesNotMatch(JSON.stringify(result), /do-not-leak|also-secret|apiKey|accessToken/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('missing profile manifest is reported as a failed check instead of throwing', async () => {
  const fixture = await createProfileFixture();
  try {
    await rm(fixture.manifest);
    const result = await inspectProfile(profileInput(fixture));

    assert.equal(result.ok, false);
    assert.equal(result.checks.find((check) => check.id === 'profile-manifest')?.ok, false);
    assert.match(result.checks.find((check) => check.id === 'profile-manifest')?.message ?? '', /missing|unreadable/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('malformed lockfile and package hash/version drift fail closed with safe diagnostics', async () => {
  const fixture = await createProfileFixture();
  try {
    await writeFile(fixture.lockfile, 'lockfileVersion: [not valid yaml\n');
    await writeFile(fixture.pluginManifest, '{"name":"dsh-safe-continuation","version":"0.2.0"}\n');
    const result = await inspectProfile(profileInput(fixture));

    assert.equal(result.ok, false);
    assert.equal(result.checks.find((check) => check.id === 'lockfile')?.ok, false);
    assert.equal(result.checks.find((check) => check.id === 'package:dsh-safe-continuation')?.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /not valid yaml|do-not-leak|also-secret/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
