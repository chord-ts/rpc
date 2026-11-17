// Спека: chord v2 в бекенд-фреймворке (SvelteKit / Express). Гипотетический POST /rpc.
// Здесь только поверхность: импорт композиции, объявление транспорта, использование формата.
//
// Причинность: клиент шлёт СЫРОЕ тело → фреймворк отдаёт event/req с нераспарсенным телом →
// адаптер на границе читает и парсит его кодеком в значение → протокол → ответ. Тело парсит
// адаптер, а не клиент и не пользовательский handler. Формат — format-ручка адаптера (как в v1
// composer.use(backendAdapter)): пользователь при желании втыкает свой кодек, протокол один.
//
// Прогон типов:
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-backend.example.ts

import { z } from 'zod';
import { fn, compose } from '../src';
import { jsonrpc, fromSvelteKit, fromExpress, devalueMock, msgpackMock, type ExpressReq, type ExpressRes } from './v2-value.helpers';

// Тривиальный сервис — объявлен один раз, переиспользуется обоими фреймворками.
class Api {
  constructor() {}
  static $echo = fn({ in: z.object({ msg: z.string() }), out: z.object({ msg: z.string() }) });
  echo: typeof Api.$echo.fn = async (x) => x;
}

// 1. Импорт композиции: одна на приложение. Протокол один (value-level).
const composer = compose({ Api });
const api = jsonrpc(composer);

// 2. Объявление транспорта — SvelteKit: src/routes/rpc/+server.ts.
// Фреймворк сам даёт event с сырым event.request; handler только зовёт адаптер.
export async function POST(event: { request: Request; locals?: unknown }): Promise<Response> {
  return fromSvelteKit(api, event); // default json — адаптер прочитает и распарсит тело
}

// 2b. Транспорт — Express: app.post('/rpc', express.raw({ type: '*/*' }), handler).
// express.raw() кладёт сырой Buffer в req.body (не express.json() — без двойного парсинга).
export async function handler(req: ExpressReq, res: ExpressRes): Promise<void> {
  return fromExpress(api, req, res); // default json
}

// 3. Использование формата — format-ручка того же адаптера, протокол не меняется:
//   SvelteKit: return fromSvelteKit(api, event, { format: devalueMock });   // пользовательский devalue
//   SvelteKit: return fromSvelteKit(api, event, { format: msgpackMock });   // бинарный msgpack
//   Express:   return fromExpress(api, req, res, { format: msgpackMock });

// --- Причинность на входящем СЫРОМ запросе (тело парсит адаптер, не handler) ---
(async () => {
  const call = (id: number) => JSON.stringify({ jsonrpc: '2.0', method: 'Api.echo', params: { msg: 'hi' }, id });

  // SvelteKit: клиентский POST пришёл сырым телом в event.request.
  const incoming = new Request('http://localhost/rpc', { method: 'POST', body: call(1) });
  const res = await POST({ request: incoming });
  console.log('SvelteKit POST →', await res.json()); // { jsonrpc: '2.0', id: 1, result: { msg: 'hi' } }

  // Express: express.raw() дал сырой Buffer, handler передал адаптеру.
  const captured: { status?: number; body?: Uint8Array | string | null } = {};
  const res2: ExpressRes = {
    status(c) { captured.status = c; return res2; },
    set() { return res2; },
    send(b) { captured.body = b; return res2; },
  };
  await handler({ method: 'POST', url: '/rpc', body: new TextEncoder().encode(call(2)) }, res2);
  // text-кодек (json) отдаёт строку, байтовый — Uint8Array; приводим к строке для разбора.
  const bodyStr = typeof captured.body === 'string' ? captured.body : new TextDecoder().decode(captured.body as Uint8Array);
  console.log('Express POST →', captured.status, JSON.parse(bodyStr));

  // Пользовательский бинарный кодек на том же api/адаптере (SvelteKit):
  const binIncoming = new Request('http://localhost/rpc', { method: 'POST', body: msgpackMock.encode({ jsonrpc: '2.0', method: 'Api.echo', params: { msg: 'bin' }, id: 3 }) });
  const binRes = await fromSvelteKit(api, { request: binIncoming }, { format: msgpackMock });
  console.log('user msgpack →', msgpackMock.decode(new Uint8Array(await binRes.arrayBuffer()))); // result: { msg: 'bin' }
})();