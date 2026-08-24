import { access, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const renames = [
  ['lib/index.mjs', 'lib/index.js'],
  ['lib/runtime-types.mjs', 'lib/runtime-types.js'],
  ['lib/index.d.mts', 'lib/index.d.ts'],
  ['lib/runtime-types.d.mts', 'lib/runtime-types.d.ts'],
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

for (const declarationName of ['lib/index.d.ts', 'lib/runtime-types.d.ts']) {
  const declarationPath = resolve(declarationName);
  let declaration;

  try {
    declaration = await readFile(declarationPath, 'utf8');
  } catch {
    continue;
  }

  const normalized = declaration.replace(/(\.[./][^'"\s]+)\.(?:mjs|mts)(?=['"])/g, '$1.js');
  if (normalized !== declaration) {
    await writeFile(declarationPath, normalized);
  }
}
