import { defineConfig } from '/Users/kevin_zjy/.dsh/plugins/dsh-operating-context/node_modules/tsdown/dist/index.mjs';

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    index: './src/index.ts',
    'runtime-types': './src/runtime-types.ts',
  },
  format: 'esm',
  outDir: 'lib',
  sourcemap: false,
});
