import { copyFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sha256File } from './hash.ts';

export type BackupFileName =
  | 'profile-manifest'
  | 'lockfile'
  | 'workspace-policy'
  | 'cordis-patch';

export type BackupFile = {
  name: BackupFileName;
  sourcePath: string;
  backupPath: string;
  sha256: string;
};

export type BackupManifest = {
  schemaVersion: 1;
  createdAt: string;
  directory: string;
  files: BackupFile[];
  manifestPath: string;
};

const BACKUP_INPUTS: readonly { name: BackupFileName; filename: string }[] = [
  { name: 'profile-manifest', filename: 'package.json' },
  { name: 'lockfile', filename: 'pnpm-lock.yaml' },
  { name: 'workspace-policy', filename: 'pnpm-workspace.yaml' },
  { name: 'cordis-patch', filename: 'cordis.patch.yml' },
];

function safeTimestamp(timestamp: string): string {
  const value = timestamp
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return value || `backup-${Date.now()}`;
}

export async function createBackup(
  profileRoot: string,
  timestamp = new Date().toISOString(),
): Promise<BackupManifest> {
  const root = resolve(profileRoot);
  const sources = BACKUP_INPUTS.map((input) => ({
    ...input,
    sourcePath: join(root, input.filename),
  }));

  for (const source of sources) {
    const file = await lstat(source.sourcePath);
    if (!file.isFile()) {
      throw new Error(`${source.filename} is not a regular profile file`);
    }
  }

  const createdAt = new Date().toISOString();
  const directory = join(root, '.dsh-doctor', 'backups', safeTimestamp(timestamp));
  await mkdir(directory, { recursive: true });

  const files: BackupFile[] = [];
  for (const source of sources) {
    const backupPath = join(directory, source.filename);
    await copyFile(source.sourcePath, backupPath);
    files.push({
      name: source.name,
      sourcePath: source.sourcePath,
      backupPath,
      sha256: await sha256File(backupPath),
    });
  }

  const manifestPath = join(directory, 'manifest.json');
  const manifest: BackupManifest = {
    schemaVersion: 1,
    createdAt,
    directory,
    files,
    manifestPath,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}
