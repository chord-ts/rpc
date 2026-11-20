import { defineConfig } from 'tsdown';

// v2 — корень dist (фасад + листья client/core/schemas/zod); v1 изолирован в dist/v1.
// Явные имена entries задают раскладку, совпадающую с package.json exports и dts-emit (tsc mirror src).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'client/index': 'src/client/index.ts',
    'core/index': 'src/core/index.ts',
    'schemas/zod': 'src/schemas/zod.ts',
    'v1/index': 'src/v1/index.ts',
    'v1/client/index': 'src/v1/client/index.ts',
    'v1/middlewares/index': 'src/v1/middlewares/index.ts',
    'v1/middlewares/cache': 'src/v1/middlewares/cache.ts',
    'v1/middlewares/express': 'src/v1/middlewares/express.ts',
    'v1/middlewares/sveltekit': 'src/v1/middlewares/sveltekit.ts',
    'v1/validators/index': 'src/v1/validators/index.ts',
    'v1/specs/index': 'src/v1/specs/index.ts',
  },
  format: ['esm'],
  dts: true, // dts генерится tsdown под забандленный js — структура совпадает (attw internal resolution)
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  target: 'es2022',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
});