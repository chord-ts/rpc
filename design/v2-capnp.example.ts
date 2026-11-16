// Пользовательский код: Cap'n Web-подобный RPC на chord.
// Сервер — наши schema-first классы + capnweb(composer). Клиент — connect<S> с pipelining.
// Синтаксис-референс: cloudflare/capnweb (RpcTarget / newHttpBatchRpcSession<Api>).
// Прогон типов:
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-capnp.example.ts

import { z } from 'zod';
import { fn, compose } from './v2-transport.helpers';
import { capability, capnweb, connect } from './v2-capnp.helpers';

// Capability: объект, который возвращается по ссылке, а не по значению.
// Держать ссылку = иметь право вызывать методы (capability-based security).
class Counter {
  #value = 0;

  static $increment = fn({ in: z.void(), out: z.number() });
  increment: typeof Counter.$increment.fn = async () => ++this.#value;

  static $get = fn({ in: z.void(), out: z.number() });
  get: typeof Counter.$get.fn = async () => this.#value;
}

class Catalog {
  constructor() {}

  static $getItem = fn({
    in: z.object({ item_id: z.string() }),
    out: z.object({ id: z.string(), name: z.string() }),
  });
  getItem: typeof Catalog.$getItem.fn = async ({ item_id }) => ({ id: item_id, name: `item ${item_id}` });

  // out: capability(Counter) — возврат becomes удалённый стаб, не JSON.
  static $counter = fn({ in: z.void(), out: capability(Counter) });
  counter: typeof Catalog.$counter.fn = async () => new Counter();
}

// --- сервер: одна регистрация, биндинг по имени протокола (как jsonrpc/rest/mcp) ---
const services = { Catalog };
const composer = compose(services, { inject: {} });
const server = capnweb(composer);

// Реальный транспорт (следующий шаг): newWebSocketRpcSession / newHttpBatchRpcSession
// поверх того же server.resolve — провод уже JSON-батч путей.
// В спайке — loopback: send = server.resolve.
const api = connect<typeof services>(server.resolve);

// --- клиент: pipelining и capabilities ---
(async () => {
  // Pipelining: свойство незавершённого вызова — без промежуточного await.
  // Один await = один round trip: весь путь уехал одним батчем.
  const name = await api.Catalog.getItem({ item_id: '42' }).name;
  console.log('pipelined name:', name);
  console.log('wire batch:', JSON.stringify(server.lastBatch));

  // Capability: получили стаб, вызываем его методы удалённо.
  const counter = await api.Catalog.counter();
  console.log('increment:', await counter.increment()); // 1
  console.log('increment:', await counter.increment()); // 2 — тот же инстанс
  console.log('get:', await counter.get()); // 2

  // Capability + pipelining: цепочка без промежуточного await — один round trip.
  const first = await api.Catalog.counter().increment();
  console.log('pipelined capability:', first); // 1 (новый Counter)
  console.log('wire batch:', JSON.stringify(server.lastBatch));
})();