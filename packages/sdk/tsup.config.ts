import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'src/index': 'src/index.ts',
    'src/types/evm/index': 'src/types/evm/index.ts',
    'src/types/btc/index': 'src/types/btc/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [/^[^./]/],
});
