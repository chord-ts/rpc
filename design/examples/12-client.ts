// 12 · Типизированный клиент (src/client). Протокол-специфичные конструкторы jsonrpc/rest,
// импорт из '@chord-ts/rpc/client'. Дженерик — тип серверного биндинга (протокол + сервисы + формат):
//   server: const api = jsonrpc(composer, { format }); fromSvelteKit(api, event)
//   client: jsonrpc<typeof api>({ endpoint, format })  /  ({ socket, format })
// Конструктор выводит сервисы и формат из типа биндинга, защищает протокол и формат, wire-типы возврата
// зависят от формата эндпоинта. Транспорт — формой init (endpoint → fetch, socket → ws).
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/12-client.ts

import { z } from 'zod';
import { compose, fn, get, post, jsonrpc as bindJsonrpc, rest as bindRest, openapi, fromSvelteKit, fromWs as serveWs, RpcError, json, type Format, type WireFn } from '../../src';
import { jsonrpc, rest } from '../../src/client';
import { LoopbackSocket } from './helpers/message';
import { Math, Catalog } from './shared';

// Сервис с типизированным Date-возвратом — для демонстрации wire-типов формата.
class Clock {
  constructor() {}
  static $now = fn({ in: z.void(), out: z.date() });
  now: typeof Clock.$now.fn = async () => new Date('2026-01-01T00:00:00Z');
}

// devalue-подобный кодек: сохраняет Date (бренд отличает формат от json на типах).
interface DevalueWire extends WireFn {
  readonly __brand: 'devalue';
  readonly __out?: this['__arg'];
}
const devalue: Format<string, DevalueWire> = {
  contentType: 'application/json',
  unit: 'text',
  decode: (raw) => JSON.parse(raw, (_k, v) => (v && typeof v === 'object' && typeof v.$date === 'string' ? new Date(v.$date) : v)),
  encode: (value) => JSON.stringify(value, function (this: Record<string, unknown>, k, v) {
    const raw = this[k];
    return raw instanceof Date ? { $date: raw.toISOString() } : v;
  }),
};

// --- сервер: RPC и REST — раздельные compose (класс протокол-согласован) ---
const rpcComposer = compose({ Math, Clock });
const api = bindJsonrpc(rpcComposer); // default json
const apiDevalue = bindJsonrpc(rpcComposer, { format: devalue });
const POST = (e: { request: Request }) => fromSvelteKit(api, e);
const POSTdevalue = (e: { request: Request }) => fromSvelteKit(apiDevalue, e);

const restComposer = compose({ Catalog });
const restApi = bindRest(restComposer);
const REST = (e: { request: Request }) => fromSvelteKit(restApi, e);
const loopback = (POST: (e: { request: Request }) => Promise<Response>) => (input: RequestInfo | URL, init?: RequestInit) =>
  POST({ request: new Request(input, init) });

(async () => {
  // [1] jsonrpc × fetch × json. Дженерик — тип серверного биндинга.
  const rpc = jsonrpc<typeof api>({ endpoint: 'http://localhost/rpc', fetch: loopback(POST) });
  console.log('12 add →', await rpc.Math.add({ a: 2, b: 3 })); // 5 (тип number)
  try {
    await rpc.Math.add({ a: 'x', b: 3 } as any);
  } catch (e) {
    console.log('12 error →', e instanceof RpcError, (e as RpcError).code); // true -32602
  }

  // [2] Wire-типы формата: Clock.now() — string через json, Date через devalue. Тип следует за форматом.
  const j = await rpc.Clock.now(undefined);
  const _j: string = j; // json: Date → string
  console.log('12 json now →', typeof j, j); // string
  const rpcDevalue = jsonrpc<typeof apiDevalue>({ endpoint: 'http://localhost/rpc', format: devalue, fetch: loopback(POSTdevalue) });
  const d = await rpcDevalue.Clock.now(undefined);
  const _d: Date = d; // devalue: Date сохранён
  console.log('12 devalue now →', d instanceof Date, d.toISOString()); // true

  // [3] Формат-гард: формат клиента обязан совпасть с форматом эндпоинта.
  // @ts-expect-error — эндпоинт devalue, транспорт json → расхождение форматов
  jsonrpc<typeof apiDevalue>({ endpoint: 'http://localhost/rpc', format: json, fetch: loopback(POST) });

  // [4] Протокол-гард: jsonrpc-конструктор требует MessageProtocol-биндинг.
  // @ts-expect-error — restApi это HttpProtocol (без message), jsonrpc-конструктор не примет
  jsonrpc<typeof restApi>({ endpoint: 'http://localhost/rpc', fetch: loopback(POST) });

  // [5] REST × fetch. Манифест = OpenAPI (тот же артефакт, что /openapi.json; доставка через load или импорт).
  const rpcRest = rest<typeof restApi>({ endpoint: 'http://localhost', doc: openapi(restComposer).document as any, fetch: loopback(REST) });
  console.log('12 rest getItem →', await rpcRest.Catalog.getItem({ item_id: '42', q: 'foo' }));
  console.log('12 rest createItem →', await rpcRest.Catalog.createItem({ name: 'widget' })); // 201
  try {
    await rpcRest.Catalog.createItem({ name: 123 } as any);
  } catch (e) {
    console.log('12 rest error →', (e as { status: number }).status); // 422
  }

  // [6] Транспорт-ручка: fetch → WS (message-проекция). Тот же конструктор, init с socket.
  const clientSock = new LoopbackSocket();
  const serverSock = new LoopbackSocket();
  clientSock.send = (data) => { void serverSock.emit(data); };
  serverSock.send = (data) => { void clientSock.emit(data); };
  serveWs(api, serverSock);
  const rpcWs = jsonrpc<typeof api>({ socket: clientSock });
  console.log('12 ws add →', await rpcWs.Math.add({ a: 2, b: 3 })); // 5
})();