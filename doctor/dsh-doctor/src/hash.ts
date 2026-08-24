import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path));
}
