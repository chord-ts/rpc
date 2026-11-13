import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/client/index.ts',
    'src/middlewares/index.ts',
    'src/middlewares/cache.ts',
    'src/middlewares/express.ts',
    'src/middlewares/sveltekit.ts',
    'src/validators/index.ts',
    'src/specs/index.ts'
  ],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  target: 'es2022',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' })
});