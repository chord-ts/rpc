// 01 · Базовый RPC (default). Декларация fn → compose → jsonrpc-биндинг → транспорт.
// Одна строка на эндпоинт: фреймворк даёт сырой event.request, адаптер парсит тело (default json).
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/01-rpc-basic.ts

import { compose, jsonrpc, fromSvelteKit } from '../../src';
import { Math } from './shared';

const composer = compose({ Math });
const api = jsonrpc(composer); // + rpc.discover

// SvelteKit: src/routes/rpc/+server.ts
export const POST = (event: { request: Request; locals?: unknown }) => fromSvelteKit(api, event);

(async () => {
  const res = await POST({
    request: new Request('http://localhost/rpc', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'Math.add', params: { a: 2, b: 3 }, id: 1 }),
    }),
  });
  console.log('01 rpc →', await res.json()); // { jsonrpc: '2.0', id: 1, result: 5 }
})();