import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'src/index': 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Keep npm packages external — CJS internals (e.g. form-data/combined-stream)
  // use dynamic require() which fails at runtime in an ESM context.
  // Bundle @kaleido-io/* workspace packages so TypeScript types are erased at
  // compile time rather than causing missing-export errors at runtime.
  external: [/^[^./]/],
  noExternal: ['@kaleido-io/core'],
});
