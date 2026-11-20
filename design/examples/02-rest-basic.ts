// 02 · Базовый REST (default). get/post с частями path/query/body, resp-карта статусов (FastAPI).
// rest — чистый роутинг. Docs — отдельные binding'и (openapi/swagger/redoc), которые пользователь
// вешает на свои GET-роуты: путь маунта выбирает он, ничего не предполагает корень.
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/02-rest-basic.ts

import { compose, rest, openapi, swagger, fromSvelteKit } from '../../src';
import { Catalog } from './shared';

const composer = compose({ Catalog });
const api = rest(composer);

// SvelteKit catch-all: src/routes/[...path]/+server.ts
export const GET = (event: { request: Request; locals?: unknown }) => fromSvelteKit(api, event);
export const POST = (event: { request: Request; locals?: unknown }) => fromSvelteKit(api, event);
export const DELETE = (event: { request: Request; locals?: unknown }) => fromSvelteKit(api, event);
export const PUT = (event: { request: Request; locals?: unknown }) => fromSvelteKit(api, event);

// Docs — отдельные GET-подроуты (src/routes/openapi.json/+server.ts, src/routes/docs/+server.ts).
// swagger вшивает документ inline — отдельный openapi-маунт и CORS ему не нужны.
export const GET_SPEC = (event: { request: Request }) => fromSvelteKit(openapi(composer), event);
export const GET_DOCS = (event: { request: Request }) => fromSvelteKit(swagger(composer), event);

(async () => {
  const got = await GET({ request: new Request('http://localhost/items/42?q=hi') });
  console.log('02 rest GET →', await got.json()); // { id: '42', name: 'item 42 (hi)' }

  const created = await POST({
    request: new Request('http://localhost/items', { method: 'POST', body: JSON.stringify({ name: 'widget' }) }),
  });
  console.log('02 rest POST →', created.status, await created.json()); // 201 { id: 'new', name: 'widget' }

  const spec = await GET_SPEC({ request: new Request('http://localhost/openapi.json') });
  console.log('02 openapi →', (await spec.json()).openapi); // 3.1.0

  const docs = await GET_DOCS({ request: new Request('http://localhost/docs') });
  console.log('02 swagger →', docs.headers.get('content-type')); // text/html; charset=utf-8
})();