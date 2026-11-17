// Пользовательский код: один протокол + один generic-адаптер + format-ручка.
// Пользователь при желании втыкает свой формат (как в v1 composer.use(backendAdapter)) —
// меняется только кодек, не адаптер и не биндинг. Никакой матрицы протокол×формат.
// Прогон типов:
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-value.example.ts

import { z } from 'zod';
import { fn, compose } from '../src';
import { jsonrpc, rest, fromSvelteKit, json, devalueMock, msgpackMock, type Format } from './v2-value.helpers';

class Math {
  constructor() {}
  static $add = fn({ in: z.object({ a: z.number(), b: z.number() }), out: z.number() });
  add: typeof Math.$add.fn = async (x) => x.a + x.b;
}
class Svc {
  constructor() {}
  static $echo = fn({ in: z.object({ name: z.string() }), out: z.object({ name: z.string() }) });
  echo: typeof Svc.$echo.fn = async (x) => x;
  static $now = fn({ in: z.unknown(), out: z.unknown() });
  now: typeof Svc.$now.fn = async () => new Date('2026-01-01T00:00:00Z');
}

const composer = compose({ Math, Svc });
const api = jsonrpc(composer); // протокол один, value-level
const restApi = rest(composer); // тот же generic-адаптер обслуживит и rest

const rpcRequest = (format: Format<any>, body: unknown) =>
  new Request('http://localhost/rpc', { method: 'POST', body: format.encode(body) });


const readWire = async (res: Response, format: Format<any>) =>
  format.unit === 'bytes' ? format.decode(new Uint8Array(await res.arrayBuffer())) : format.decode(await res.text());
const addCall = { jsonrpc: '2.0', method: 'Math.add', params: { a: 2, b: 3 }, id: 1 };

(async () => {
  // Default: кодек не указан — адаптер использует json. Протокол/адаптер те же.
  const def = await fromSvelteKit(api, { request: rpcRequest(json, addCall) });
  console.log('default json →', await readWire(def, json)); // result: 5

  // Пользователь втыкает devalue (как v1 backendAdapter с devalue.parse) — тот же api/адаптер.
  const devalueRes = await fromSvelteKit(api, { request: rpcRequest(devalueMock, addCall) }, { format: devalueMock });
  console.log('user devalue →', await readWire(devalueRes, devalueMock)); // result: 5

  // Пользователь втыкает бинарный msgpack — тот же api/адаптер, меняется только кодек.
  const binRes = await fromSvelteKit(api, { request: rpcRequest(msgpackMock, addCall) }, { format: msgpackMock });
  console.log('user msgpack →', await readWire(binRes, msgpackMock)); // result: 5

  // Кодек меняет fidelity значений: devalue восстанавливает Date, json теряет. Протокол тот же.
  const nowCall = { jsonrpc: '2.0', method: 'Svc.now', id: 2 };
  const j = await fromSvelteKit(api, { request: rpcRequest(json, nowCall) });
  const d = await fromSvelteKit(api, { request: rpcRequest(devalueMock, nowCall) }, { format: devalueMock });
  console.log('json Date →', typeof (await readWire(j, json) as { result: unknown }).result); // string
  console.log('devalue Date →', (await readWire(d, devalueMock) as { result: unknown }).result instanceof Date ? 'Date' : '?'); // Date

  // formdata — read-режим того же адаптера (multipart парсит платформа); ответ json.
  const fd = new FormData();
  fd.set('name', 'widget');
  const formRes = await fromSvelteKit(restApi, { request: new Request('http://localhost/echo', { method: 'POST', body: fd }) }, { as: 'formdata' });
  console.log('formdata →', await formRes.json()); // { name: 'widget' }

  // docs — raw-escape того же адаптера: text/html даже с msgpack-кодеком, мимо кодека.
  const docsRes = await fromSvelteKit(restApi, { request: new Request('http://localhost/docs') }, { format: msgpackMock });
  console.log('docs:', docsRes.headers.get('content-type'), '|', await docsRes.text());
})();