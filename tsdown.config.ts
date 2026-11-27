import { defineConfig } from 'tsdown';
import { fileURLToPath } from 'node:url';

// v2 — корень dist (фасад + листья client/core/schemas/zod); v1 изолирован в dist/v1.
// Явные имена entries задают раскладку, совпадающую с package.json exports и dts-emit (tsc mirror src).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'client/index': 'src/client/index.ts',
    'core/index': 'src/core/index.ts',
    'schemas/zod': 'src/schemas/zod.ts',
    'mcp-handler/index': 'src/mcp/vercel/index.ts',
    // Гранулярные v2-сабпаты (tree-shaking): протоколы — top-level папки (impl + docs + index).
    jsonrpc: 'src/jsonrpc/index.ts',
    rest: 'src/rest/index.ts',
    mcp: 'src/mcp/index.ts',
    tools: 'src/tools/index.ts',
    // capnweb не публикуется до закрытия security-долга (RCE) — код остаётся в src.
    events: 'src/events/index.ts',
    'transport/sveltekit': 'src/transport/sveltekit.ts',
    'transport/express': 'src/transport/express.ts',
    // WS-транспорт не публикуется до стабилизации (одна подписка на сокет, без мультиплексирования
    // стримов) — код и тесты остаются в src. Клиентский socket-режим ./client сохранён.
    'v1/index': 'src/v1/index.ts',
    'v1/client/index': 'src/v1/client/index.ts',
    'v1/middlewares/index': 'src/v1/middlewares/index.ts',
    'v1/middlewares/cache': 'src/v1/middlewares/cache.ts',
    'v1/middlewares/express': 'src/v1/middlewares/express.ts',
    'v1/middlewares/sveltekit': 'src/v1/middlewares/sveltekit.ts',
    'v1/validators/index': 'src/v1/validators/index.ts',
    'v1/specs/index': 'src/v1/specs/index.ts',
  },
  // Dual ESM+CJS: v1 был CommonJS, require('@chord-ts/rpc') должен продолжать работать.
  // .js — ESM ("type":"module"), .cjs — CJS; декларации .d.ts / .d.cts под каждый формат.
  format: ['esm', 'cjs'],
  alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  dts: true, // dts генерится tsdown под забандленный js — структура совпадает (attw internal resolution)
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  target: 'es2022',
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
});