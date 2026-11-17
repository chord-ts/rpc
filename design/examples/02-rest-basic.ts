// 02 · Базовый REST (default). get/post с частями path/query/body, resp-карта статусов (FastAPI).
// Docs-эндпоинты транзитивны: rest сам отдаёт /openapi.json, /docs, /redoc.
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/02-rest-basic.ts

import { compose, rest, fromSvelteKit } from '../../src';
import { Catalog } from './shared';

const composer = compose({ Catalog });
const api = rest(composer);

// SvelteKit catch-all: src/routes/[...path]/+server.ts
export const GET = (event: { request: Request; locals?: unknown }) => fromSvelteKit(api, event);
export const POST = (event: { request: Request; locals?: unknown }) => fromSvelteKit(api, event);
export const DELETE = (event: { request: Request; locals?: unknown }) => fromSvelteKit(api, event);
export const PUT = (event: { request: Request; locals?: unknown }) => fromSvelteKit(api, event);

(async () => {
  const got = await GET({ request: new Request('http://localhost/items/42?q=hi') });
  console.log('02 rest GET →', await got.json()); // { id: '42', name: 'item 42 (hi)' }

  const created = await POST({
    request: new Request('http://localhost/items', { method: 'POST', body: JSON.stringify({ name: 'widget' }) }),
  });
  console.log('02 rest POST →', created.status, await created.json()); // 201 { id: 'new', name: 'widget' }

  const spec = await GET({ request: new Request('http://localhost/openapi.json') });
  console.log('02 openapi →', (await spec.json()).openapi); // 3.1.0
})();