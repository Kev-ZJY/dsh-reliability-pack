import { access, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const renames = [
  ['lib/index.mjs', 'lib/index.js'],
  ['lib/index.d.mts', 'lib/index.d.ts'],
];

for (const [from, to] of renames) {
  const source = resolve(from);
  const target = resolve(to);

  try {
    await access(source);
  } catch {
    continue;
  }

  await rm(target, { force: true });
  await rename(source, target);
}

const declarationPath = resolve('lib/index.d.ts');

try {
  const declaration = await readFile(declarationPath, 'utf8');
  const normalized = declaration.replace(/(\.[./][^'"\s]+)\.(?:mjs|mts)(?=['"])/g, '$1.js');

  if (normalized !== declaration) {
    await writeFile(declarationPath, normalized);
  }
} catch {}
