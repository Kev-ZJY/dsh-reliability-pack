import { rename } from 'node:fs/promises';
import { resolve } from 'node:path';

const renames = [
  ['lib/index.mjs', 'lib/index.js'],
  ['lib/runtime-types.mjs', 'lib/runtime-types.js'],
  ['lib/index.d.mts', 'lib/index.d.ts'],
  ['lib/runtime-types.d.mts', 'lib/runtime-types.d.ts'],
];

for (const [from, to] of renames) {
  await rename(resolve(from), resolve(to));
}
