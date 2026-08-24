import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const repositoryRoot = process.cwd();
const cliPath = join(repositoryRoot, 'doctor/dsh-doctor/lib/index.js');
const sourcePath = join(repositoryRoot, 'doctor/dsh-doctor/src/index.ts');
const packagePath = join(repositoryRoot, 'doctor/dsh-doctor/package.json');

function runCli(args: readonly string[], environment: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [cliPath, ...args], {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment },
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error !== null && typeof error.code !== 'number') {
        reject(error);
        return;
      }
      const code = error === null ? 0 : error.code as number;
      resolve({
        code,
        stdout,
        stderr,
      });
    });
  });
}

async function createFixture(): Promise<{
  root: string;
  profileRoot: string;
  cachePath: string;
  sessionPath: string;
  secret: string;
  environment: NodeJS.ProcessEnv;
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doctor-cli-'));
  const profileRoot = join(root, 'profiles', 'web');
  const storageRoot = join(root, 'storages');
  const tokenMeterRoot = join(root, 'node_modules/@deepseek-ai/dsh-token-meter');
  const fakeBinRoot = join(root, 'bin');
  await mkdir(profileRoot, { recursive: true });
  await mkdir(storageRoot, { recursive: true });
  await mkdir(tokenMeterRoot, { recursive: true });
  await mkdir(fakeBinRoot, { recursive: true });

  await writeFile(join(profileRoot, 'package.json'), '{"name":"dsh-profile-web","version":"1.0.0"}\n');
  await writeFile(join(profileRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\nimporters:\n  .:\n');
  await writeFile(join(profileRoot, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
  await writeFile(join(profileRoot, 'cordis.patch.yml'), 'id: profile\nname: web\n');
  await writeFile(join(tokenMeterRoot, 'package.json'), '{"name":"@deepseek-ai/dsh-token-meter","version":"1.2.3"}\n');

  const secret = 'sk-cli-smoke-secret-123';
  const cachePath = join(storageRoot, 'session_projcache.json');
  await writeFile(cachePath, JSON.stringify({
    tables: {
      sessions: {
        affected: {
          rows: {
            context: { ver: 2, val: { surfaceTokens: -7 } },
          },
        },
      },
    },
    apiKey: secret,
  }) + '\n');
  const sessionPath = join(storageRoot, 'affected.jsonl');
  await writeFile(sessionPath, JSON.stringify({ id: 'affected', text: secret }) + '\n');

  const fakeDshPath = join(fakeBinRoot, 'dsh');
  const updateLogPath = join(root, 'update.log');
  await writeFile(fakeDshPath, `#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';

if (process.argv.includes('update')) {
  await appendFile(${JSON.stringify(updateLogPath)}, 'update-called\\n');
  process.exitCode = 23;
} else if (process.argv.includes('--dump-config')) {
  process.stdout.write('{"ok":true}\\n');
}
`);
  await chmod(fakeDshPath, 0o755);

  return {
    root,
    profileRoot,
    cachePath,
    sessionPath,
    secret,
    environment: {
      DSH_HOME: root,
      DSH_DOCTOR_SESSION_RECORDS: sessionPath,
      PATH: `${fakeBinRoot}:${process.env.PATH ?? ''}`,
    },
  };
}

test('published dsh-doctor CLI checks, reports read-only, and previews without mutation', async () => {
  const fixture = await createFixture();
  try {
    const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as {
      bin?: Record<string, string>;
      files?: string[];
    };
    assert.equal(manifest.bin?.['dsh-doctor'], './lib/index.js');
    assert.equal(manifest.files?.includes('lib'), true);
    assert.equal(manifest.files?.includes('README.md'), true);
    assert.match(await readFile(sourcePath, 'utf8'), /^#!\/usr\/bin\/env node/m);

    const profileFiles = [
      join(fixture.profileRoot, 'package.json'),
      join(fixture.profileRoot, 'pnpm-lock.yaml'),
      join(fixture.profileRoot, 'pnpm-workspace.yaml'),
      join(fixture.profileRoot, 'cordis.patch.yml'),
    ];
    const beforeProfile = await Promise.all(profileFiles.map(async (path) => ({
      path,
      text: await readFile(path, 'utf8'),
      mtimeMs: (await stat(path)).mtimeMs,
    })));
    const beforeCache = {
      text: await readFile(fixture.cachePath, 'utf8'),
      mtimeMs: (await stat(fixture.cachePath)).mtimeMs,
    };

    const check = await runCli(['check', '--profile', 'web'], fixture.environment);
    assert.equal(check.code, 0, check.stderr);
    assert.match(check.stdout, /\[ok\] profile-manifest/);
    assert.match(check.stdout, /config-dump/);

    const report = await runCli(['report-token-meter', '--profile', 'web'], fixture.environment);
    assert.equal(report.code, 0, report.stderr);
    assert.match(report.stdout, /"packageVersion": "1\.2\.3"/);
    assert.match(report.stdout, /"value": -7/);
    assert.doesNotMatch(`${report.stdout}\n${report.stderr}`, new RegExp(fixture.secret));
    assert.equal(await readFile(fixture.cachePath, 'utf8'), beforeCache.text);
    assert.equal((await stat(fixture.cachePath)).mtimeMs, beforeCache.mtimeMs);

    await writeFile(join(fixture.profileRoot, 'pnpm-lock.yaml'), 'lockfileVersion: [broken\n');
    const failedCheck = await runCli(['check', '--profile', 'web'], fixture.environment);
    assert.equal(failedCheck.code, 1);
    assert.match(failedCheck.stderr, /lockfile/i);
    await writeFile(join(fixture.profileRoot, 'pnpm-lock.yaml'), beforeProfile[1].text);
    const beforePreviewProfile = await Promise.all(profileFiles.map(async (path) => ({
      path,
      text: await readFile(path, 'utf8'),
      mtimeMs: (await stat(path)).mtimeMs,
    })));

    const preview = await runCli(['update-profile', '--profile', 'web', '--preview'], fixture.environment);
    assert.equal(preview.code, 0, preview.stderr);
    assert.match(preview.stdout, /preview/i);
    assert.doesNotMatch(preview.stdout, /update-called/);
    await assert.rejects(stat(join(fixture.profileRoot, '.dsh-doctor')));
    for (const before of beforePreviewProfile) {
      assert.equal(await readFile(before.path, 'utf8'), before.text);
      assert.equal((await stat(before.path)).mtimeMs, before.mtimeMs);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
