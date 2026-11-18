// 09 · Binding на уровне адаптера (продвинутый, механики в src). Разворот зависимостей: протокол сам отдаёт
// адаптеру нужный контракт (проекции), адаптер не подстраивается под форму протокола:
//   fromSvelteKit/fromExpress знают HTTP → требуют { http };  fromWs знает фреймы → требует { message }.
//   rest → { http } (транспорт-адресуемый);  jsonrpc/mcp/capnweb → { message, http } (самоадресуемые,
//   http — встроенный мост). Пользователь не пишет кастомный binding и не выбирает мост.
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/09-protocol-bindings.ts

import { compose, rest, jsonrpc, mcp, capnweb, fromSvelteKit, fromWs, json } from '../../src';
import { ZodAdapter } from '../../src/schemas/zod';
import { Catalog, Math } from './shared';
import { LoopbackSocket } from './helpers/message';

const composer = compose({ Catalog, Math }, { inject: {}, schemas: new ZodAdapter() });

// Протокол объявляется один раз — без знания о транспорте и без аннотаций контракта.
const api = rest(composer);
const rpc = jsonrpc(composer);
const agent = mcp(composer);
const cap = capnweb(composer);

const rpcReq = (body: unknown) => new Request('http://localhost/rpc', { method: 'POST', body: JSON.stringify(body) });

(async () => {
  // HTTP-адаптер сам знает HTTP: REST — нативная проекция, jsonrpc/mcp — встроенный мост.
  const restRes = await fromSvelteKit(api, { request: new Request('http://localhost/items/42') });
  console.log('09 REST → HTTP →', await restRes.json()); // { id: '42', name: 'item 42' }

  const rpcRes = await fromSvelteKit(rpc, { request: rpcReq({ jsonrpc: '2.0', method: 'Math.add', params: { a: 2, b: 3 }, id: 1 }) });
  console.log('09 jsonrpc → HTTP →', await rpcRes.json()); // result: 5

  const mcpRes = await fromSvelteKit(agent, { request: rpcReq({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 3 }) });
  console.log('09 mcp → HTTP →', (await mcpRes.json()).result.tools.map((t: any) => t.name));

  // WS-адаптер знает message: тот же rpc, без HTTP-заглушек и без ручного моста.
  const ws = new LoopbackSocket();
  fromWs(rpc, ws, { format: json });
  await ws.emit(JSON.stringify({ jsonrpc: '2.0', method: 'Math.add', params: { a: 2, b: 3 }, id: 2 }));
  console.log('09 jsonrpc → WS →', json.decode(ws.sent[0] as string)); // result: 5

  // Проекции — обычные поля: кастомный транспорт/in-process берёт контракт напрямую.
  const batch = [{ from: null, steps: [{ get: 'Math' }, { call: 'add', args: [{ a: 2, b: 3 }] }] }];
  console.log('09 capnweb message (batch) →', await cap.message.handle(batch)); // [ 5 ]

  // @ts-expect-error — REST транспорт-адресуемый: message-проекции нет, WS недоступен на этапе типов.
  fromWs(api, new LoopbackSocket());
})();
