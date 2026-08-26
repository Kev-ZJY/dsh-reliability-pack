import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256File } from '../src/hash.ts';
import { createBackup } from '../src/backup.ts';
import {
  parseDoctorArgs,
  runCheck,
  runProfileUpdate,
  runTokenMeterReport,
  type DoctorIO,
  type ProfileUpdateArgs,
} from '../src/commands.ts';

type ProfileFixture = {
  root: string;
  args: ProfileUpdateArgs;
  inputs: string[];
};

async function createProfileFixture(): Promise<ProfileFixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doctor-commands-'));
  const manifestPath = join(root, 'package.json');
  const lockfilePath = join(root, 'pnpm-lock.yaml');
  const workspacePolicyPath = join(root, 'pnpm-workspace.yaml');
  const cordisPatchPath = join(root, 'cordis.patch.yml');
  await writeFile(manifestPath, '{"name":"web","version":"1.0.0"}\n');
  await writeFile(lockfilePath, 'lockfileVersion: 9.0\nimporters:\n  .:\n');
  await writeFile(workspacePolicyPath, 'packages:\n  - .\n');
  await writeFile(cordisPatchPath, 'id: safe-continuation\nname: dsh-safe-continuation\n');

  const inputs = [manifestPath, lockfilePath, workspacePolicyPath, cordisPatchPath];
  return {
    root,
    inputs,
    args: {
      profile: 'web',
      profileRoot: root,
      profilePath: root,
      profileName: 'web',
      manifestPath,
      lockfilePath,
      workspacePolicyPath,
      cordisPatchPath,
      timestamp: '2026-08-24T01-02-03-000Z',
    },
  };
}

function captureIO(overrides: DoctorIO = {}): { io: DoctorIO; output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    output,
    errors,
    io: {
      stdout: (line) => output.push(line),
      stderr: (line) => errors.push(line),
      ...overrides,
    },
  };
}

function runnerFor(options: { updateExitCode?: number; dumpExitCode?: number; stderr?: string } = {}) {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const runner = async (command: string, args: readonly string[]) => {
    calls.push({ command, args: [...args] });
    if (args.includes('update')) {
      return { exitCode: options.updateExitCode ?? 0, stderr: options.stderr ?? '' };
    }
    if (args.includes('--dump-config')) {
      return { exitCode: options.dumpExitCode ?? 0, stdout: '{"ok":true}\n' };
    }
    return { exitCode: 0 };
  };
  return { calls, runner };
}

test('parseDoctorArgs accepts the three commands and restricts preview to updates', () => {
  assert.deepEqual(parseDoctorArgs(['check', '--profile', 'web']), {
    command: 'check',
    profile: 'web',
    preview: false,
  });
  assert.deepEqual(parseDoctorArgs(['report-token-meter', '--profile', 'web']), {
    command: 'report-token-meter',
    profile: 'web',
    preview: false,
  });
  assert.deepEqual(parseDoctorArgs(['update-profile', '--profile', 'web', '--preview']), {
    command: 'update-profile',
    profile: 'web',
    preview: true,
  });
  assert.throws(() => parseDoctorArgs(['check', '--profile', 'web', '--preview']), /unknown argument|only valid/i);
});

test('runCheck returns 0 for a clean profile and 1 for a failed required check', async () => {
  const fixture = await createProfileFixture();
  try {
    const cleanRunner = runnerFor();
    const cleanIO = captureIO({ commandRunner: cleanRunner.runner });
    assert.equal(await runCheck(fixture.args, cleanIO.io), 0);

    await writeFile(fixture.inputs[1], 'lockfileVersion: [broken\n');
    const failedRunner = runnerFor();
    const failedIO = captureIO({ commandRunner: failedRunner.runner });
    assert.equal(await runCheck(fixture.args, failedIO.io), 1);
    assert.match(failedIO.errors.join('\n'), /lockfile|failed/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('runTokenMeterReport is read-only and redacts sensitive report data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doctor-report-'));
  const packageManifestPath = join(root, 'token-meter-package.json');
  const cachePath = join(root, 'session_projcache.json');
  const sessionRecordPath = join(root, 'session.jsonl');
  const secret = 'sk-report-secret-123';
  await writeFile(packageManifestPath, '{"name":"token-meter","version":"1.0.0"}\n');
  await writeFile(cachePath, JSON.stringify({
    tables: {
      sessions: {
        affected: { rows: { context: { ver: 2, val: { surfaceTokens: -7 } } } },
      },
    },
    apiKey: secret,
  }) + '\n');
  await writeFile(sessionRecordPath, JSON.stringify({ id: 'affected', text: secret }) + '\n');
  const before = await Promise.all([packageManifestPath, cachePath, sessionRecordPath].map(async (path) => ({
    path,
    text: await readFile(path, 'utf8'),
    mtimeMs: (await stat(path)).mtimeMs,
  })));
  const captured = captureIO();

  try {
    const exitCode = await runTokenMeterReport({
      packageManifestPath,
      cachePaths: [cachePath],
      sessionRecordPaths: [sessionRecordPath],
    }, captured.io);
    assert.equal(exitCode, 0);
    assert.doesNotMatch(captured.output.join('\n'), new RegExp(secret));
    for (const item of before) {
      assert.equal(await readFile(item.path, 'utf8'), item.text);
      assert.equal((await stat(item.path)).mtimeMs, item.mtimeMs);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preview performs no backup or command mutation', async () => {
  const fixture = await createProfileFixture();
  const before = await Promise.all(fixture.inputs.map(async (path) => readFile(path, 'utf8')));
  const command = runnerFor();
  const captured = captureIO({ commandRunner: command.runner });
  try {
    assert.equal(await runProfileUpdate({ ...fixture.args, preview: true }, captured.io), 0);
    assert.deepEqual(await Promise.all(fixture.inputs.map(async (path) => readFile(path, 'utf8'))), before);
    assert.deepEqual(command.calls, []);
    await assert.rejects(stat(join(fixture.root, '.dsh-doctor')));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('createBackup copies only the four profile inputs and records their hashes', async () => {
  const fixture = await createProfileFixture();
  try {
    const backup = await createBackup(fixture.root, fixture.args.timestamp);
    assert.deepEqual(backup.files.map((file) => file.name), [
      'profile-manifest',
      'lockfile',
      'workspace-policy',
      'cordis-patch',
    ]);
    assert.equal(backup.files.length, 4);
    assert.equal(backup.files.every((file) => file.sha256.length === 64), true);
    const names = await readdir(backup.directory);
    assert.deepEqual(names.sort(), ['cordis.patch.yml', 'manifest.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].sort());
    for (const file of backup.files) {
      assert.equal(await sha256File(file.backupPath), file.sha256);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('runProfileUpdate backs up first, invokes only the profile update command, and validates dump-config', async () => {
  const fixture = await createProfileFixture();
  const command = runnerFor();
  const captured = captureIO({ commandRunner: command.runner });
  try {
    assert.equal(await runProfileUpdate(fixture.args, captured.io), 0);
    assert.deepEqual(command.calls, [
      { command: 'dsh', args: ['plugin', '--profile', 'web', 'update'] },
      { command: 'dsh', args: ['--profile', 'web', '--dump-config'] },
    ]);
    const forbidden = /npm|install|-g|global|token-meter|projcache|session|jsonl/i;
    assert.equal(forbidden.test(command.calls[0].args.join(' ')), false);
    assert.match(captured.output.join('\n'), /backup/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('runProfileUpdate reports backup on update command failure without rollback', async () => {
  const fixture = await createProfileFixture();
  const command = runnerFor({ updateExitCode: 17, stderr: 'apiKey=sk-update-secret' });
  const captured = captureIO({ commandRunner: command.runner });
  try {
    assert.equal(await runProfileUpdate(fixture.args, captured.io), 1);
    assert.equal(command.calls.length, 1);
    assert.match(captured.errors.join('\n'), /backup/i);
    assert.doesNotMatch(captured.errors.join('\n'), /sk-update-secret/);
    assert.match(captured.errors.join('\n'), /REDACTED/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('runProfileUpdate reports backup when post-update dump-config validation fails', async () => {
  const fixture = await createProfileFixture();
  const command = runnerFor({ dumpExitCode: 9 });
  const captured = captureIO({ commandRunner: command.runner });
  try {
    assert.equal(await runProfileUpdate(fixture.args, captured.io), 1);
    assert.deepEqual(command.calls, [
      { command: 'dsh', args: ['plugin', '--profile', 'web', 'update'] },
      { command: 'dsh', args: ['--profile', 'web', '--dump-config'] },
    ]);
    assert.match(captured.errors.join('\n'), /validation|backup/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('runProfileUpdate exits 0 with warning when post-update validator throws (validator error, not profile corruption)', async () => {
  const fixture = await createProfileFixture();
  const command = runnerFor();
  const captured = captureIO({ commandRunner: command.runner });
  try {
    const exitCode = await runProfileUpdate(fixture.args, {
      ...captured.io,
      inspectProfile: async () => {
        throw new Error('validator internal error: cannot read config');
      },
    });
    assert.equal(exitCode, 0);
    const errors = captured.errors.join('\n');
    assert.match(errors, /post-update validation could not run/i);
    assert.match(errors, /validator error: validator internal error: cannot read config/i);
    assert.match(errors, /update itself exited 0/i);
    assert.match(errors, /backup:/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('runProfileUpdate exits 1 when post-update validation explicitly fails (ok: false)', async () => {
  const fixture = await createProfileFixture();
  const command = runnerFor();
  const captured = captureIO({ commandRunner: command.runner });
  try {
    const exitCode = await runProfileUpdate(fixture.args, {
      ...captured.io,
      inspectProfile: async () => ({
        ok: false,
        checks: [{ id: 'cordis-patch', ok: false, message: 'Cordis patch is malformed', path: fixture.args.cordisPatchPath }],
      }),
    });
    assert.equal(exitCode, 1);
    const errors = captured.errors.join('\n');
    assert.match(errors, /post-update validation failed/i);
    assert.match(errors, /backup:/i);
    assert.match(errors, /malformed/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
