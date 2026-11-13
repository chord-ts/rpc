import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/v1/index.ts',
    'src/v1/client/index.ts',
    'src/v1/middlewares/index.ts',
    'src/v1/middlewares/cache.ts',
    'src/v1/middlewares/express.ts',
    'src/v1/middlewares/sveltekit.ts',
    'src/v1/validators/index.ts',
    'src/v1/specs/index.ts'
  ],
  format: ['esm'],
  dts: false,
  outDir: 'dist/v1',
  clean: true,
  sourcemap: true,
  target: 'es2022',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' })
});