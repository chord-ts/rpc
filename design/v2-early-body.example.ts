// Спека: РАННЕЕ извлечение тела — пользователь парсит запрос ДО адаптера (как v1 backendAdapter:
// ctx.body = devalue.parse(await event.request.text())). Что становится с format:
//   - тело уже ЗНАЧЕНИЕ → format.decode не нужен (запрос распарсен ранним middleware/пользователем);
//   - format работает только на ОТВЕТ (encode) — сериализатор ответа;
//   - кодеки запроса и ответа могут РАЗЛИЧАТЬСЯ (между ними значение — value-level шов).
// Контраст: обычно адаптер читает сырой провод и декодирует (format в обе стороны). Если тело
// вытащили раньше, адаптер не может прочитать stream повторно → нужен value-level путь: биндинг
// потребляет значение независимо от того, кто его распарсил.
//
// Прогон типов:
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-early-body.example.ts

import { z } from 'zod';
import { fn, compose } from '../src';
import { jsonrpc, fromSvelteKit, json, devalueMock, type ProtocolResponse, type ExpressRes } from './v2-value.helpers';

class Api {
  constructor() {}
  static $echo = fn({ in: z.object({ msg: z.string() }), out: z.object({ msg: z.string() }) });
  echo: typeof Api.$echo.fn = async (x) => x;
}
const composer = compose({ Api });
const api = jsonrpc(composer); // value-level биндинг: потребляет значение

// format при раннем извлечении — ТОЛЬКО encode ответа (decode запроса уже сделал пользователь).
const respond = (res: ProtocolResponse, format = json): Response =>
  new Response(res.status === 204 ? null : format.encode(res.body), {
    status: res.status,
    headers: { 'content-type': format.contentType, ...res.headers },
  });

// === SvelteKit: пользователь вытащил тело рано (request.json() съедает stream) ===
export async function POST(event: { request: Request; locals?: unknown }): Promise<Response> {
  const body = await event.request.json(); // РАННИЙ парсинг — адаптер уже не прочитает stream
  const res = await api.handle({ method: 'POST', url: event.request.url, body }, event.locals);
  return respond(res); // format = только encode ответа
}

// === Express: express.json() уже распарсил req.body в объект (не сырой Buffer) ===
export async function handler(
  req: { method: string; url: string; body?: unknown; ctx?: unknown },
  res: ExpressRes,
): Promise<void> {
  const r = await api.handle({ method: req.method, url: `http://localhost${req.url}`, body: req.body }, req.ctx);
  res.status(r.status).set('content-type', json.contentType).send(json.encode(r.body)); // format = encode ответа
}

(async () => {
  const call = (id: number) => JSON.stringify({ jsonrpc: '2.0', method: 'Api.echo', params: { msg: 'hi' }, id });

  // 1. Что будет, если вытащить тело раньше и позвать ОБЫЧНЫЙ адаптер: stream уже съеден,
  //    повторное чтение падает → адаптер отдаёт 400 Parse error.
  const eaten = new Request('http://localhost/rpc', { method: 'POST', body: call(1) });
  await eaten.json(); // раннее извлечение
  const broken = await fromSvelteKit(api, { request: eaten });
  console.log('раннее тело + обычный адаптер →', broken.status, await broken.json()); // 400 Parse error

  // 2. Правильный путь: раннее значение → value-level биндинг → format только на ответ.
  const req2 = new Request('http://localhost/rpc', { method: 'POST', body: call(2) });
  const early = await req2.json(); // пользователь распарсил рано
  const res2 = await api.handle({ method: 'POST', url: req2.url, body: early });
  console.log('раннее тело + value-level →', await respond(res2).json()); // result: { msg: 'hi' }

  // 3. v1-паттерн: запрос распарсен РАНO своим кодеком (devalue), ответ — другим (json).
  //    Кодеки запроса/ответа различаются, т.к. между ними значение.
  const devalueBody = devalueMock.decode(call(3)); // ранний парсинг devalue (пользовательский)
  const res3 = await api.handle({ method: 'POST', url: 'http://localhost/rpc', body: devalueBody });
  console.log('devalue-запрос / json-ответ →', await respond(res3, json).json()); // result: { msg: 'hi' }

  // 4. Express: express.json() дал готовый объект в req.body — decode не нужен, format на ответ.
  const captured: { status?: number; body?: unknown } = {};
  const res4: ExpressRes = {
    status(c) { captured.status = c; return res4; },
    set() { return res4; },
    send(b) { captured.body = b; return res4; },
  };
  await handler({ method: 'POST', url: '/rpc', body: JSON.parse(call(4)) }, res4); // req.body — уже объект
  console.log('Express express.json() →', captured.status, JSON.parse(captured.body as string)); // result: { msg: 'hi' }
})();