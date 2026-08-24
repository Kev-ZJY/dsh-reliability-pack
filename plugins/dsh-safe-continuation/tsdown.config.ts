import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    index: './src/index.ts',
    'runtime-types': './src/runtime-types.ts',
  },
  format: 'esm',
  outDir: 'lib',
  outExtensions: () => ({ js: '.js' }),
  sourcemap: false,
});
