// 04 · Форматы (расширенный, default → custom). Format — codec-ручка generic-адаптера:
// default json, пользователь втыкает devalue/msgpack сменой кодека (протокол/адаптер те же).
// formdata — read-режим; раннее извлечение тела — нативный message-шов (значение на руках).
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/04-formats.ts

import { compose, jsonrpc, rest, fromSvelteKit, json, type Format } from '../../src';
import { Catalog, Echo, Math } from './shared';
import { devalueMock, msgpackMock } from './codecs';

const composer = compose({ Catalog, Echo, Math });
const rpcApi = jsonrpc(composer);
const restApi = rest(composer);

const rpcReq = (format: Format<any>, body: unknown) =>
  new Request('http://localhost/rpc', { method: 'POST', body: format.encode(body) });

const readWire = async (res: Response, format: Format<any>) =>
  format.unit === 'bytes' ? format.decode(new Uint8Array(await res.arrayBuffer())) : format.decode(await res.text());
const addCall = { jsonrpc: '2.0', method: 'Math.add', params: { a: 2, b: 3 }, id: 1 };

(async () => {
  // default json — кодек не указан.
  console.log('04 default json →', await readWire(await fromSvelteKit(rpcApi, { request: rpcReq(json, addCall) }), json));

  // custom devalue / msgpack — тот же rpcApi/адаптер, меняется только кодек.
  const dv = await fromSvelteKit(rpcApi, { request: rpcReq(devalueMock, addCall) }, { format: devalueMock });
  console.log('04 devalue →', await readWire(dv, devalueMock));
  const mp = await fromSvelteKit(rpcApi, { request: rpcReq(msgpackMock, addCall) }, { format: msgpackMock });
  console.log('04 msgpack →', await readWire(mp, msgpackMock));

  // Кодек меняет fidelity: json Date теряет, devalue восстанавливает.
  const nowCall = { jsonrpc: '2.0', method: 'Echo.now', id: 2 };
  const j = (await readWire(await fromSvelteKit(rpcApi, { request: rpcReq(json, nowCall) }), json)) as any;
  const d = (await readWire(await fromSvelteKit(rpcApi, { request: rpcReq(devalueMock, nowCall) }, { format: devalueMock }), devalueMock)) as any;
  console.log('04 Date json/devalue →', typeof j.result, d.result instanceof Date ? 'Date' : '?');

  // formdata — read-режим адаптера (multipart парсит платформа), ответ json.
  const fd = new FormData();
  fd.set('name', 'widget');
  const formRes = await fromSvelteKit(restApi, { request: new Request('http://localhost/items', { method: 'POST', body: fd }) }, { as: 'formdata' });
  console.log('04 formdata →', await formRes.json()); // { id: 'new', name: 'widget' }

  // Раннее извлечение: тело распарсено пользователем (кастомный формат / express.json()) →
  // значение на руках → нативный message-шов: без dummy method/url, null = notification.
  const req = new Request('http://localhost/rpc', { method: 'POST', body: JSON.stringify(addCall) });
  const early = await req.json();
  const reply = await rpcApi.message.handle(early);
  console.log('04 early-body (message) →', reply); // { jsonrpc, id: 1, result: 5 }
})();