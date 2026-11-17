// 07 · Cap'n Web (продвинутый). Schema-first RPC с pipelining и capabilities: объект возвращается
// по ссылке (capability), клиент вызывает его методы удалённо. Переиспользует Counter.
// Capability-каталог специализирован (out: capability(Counter)) — отдельный класс по необходимости.
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/07-capnweb.ts

import { z } from 'zod';
import { fn, compose } from '../../src';
import { capability, capnweb, connect } from './helpers/capnweb';
import { Counter } from './shared';

class CapCatalog {
  constructor() {}
  static $getItem = fn({
    in: z.object({ item_id: z.string() }),
    out: z.object({ id: z.string(), name: z.string() }),
  });
  getItem: typeof CapCatalog.$getItem.fn = async ({ item_id }) => ({ id: item_id, name: `item ${item_id}` });

  // out: capability(Counter) — возврат становится удалённым стабом, не JSON.
  static $counter = fn({ in: z.void(), out: capability(Counter) });
  counter: typeof CapCatalog.$counter.fn = async () => new Counter();
}

const composer = compose({ Catalog: CapCatalog }, { inject: {} });
const server = capnweb(composer);
const api = connect(server); // S выводится из composer, без ручного generic

(async () => {
  // Pipelining: свойство незавершённого вызова — без промежуточного await (один round trip).
  const name = await api.Catalog.getItem({ item_id: '42' }).name;
  console.log('07 pipelined name →', name); // item 42

  // Capability: получили стаб, вызываем методы удалённо (тот же инстанс).
  const counter = await api.Catalog.counter();
  console.log('07 increment →', await counter.increment()); // 1
  console.log('07 increment →', await counter.increment()); // 2
  console.log('07 get →', await counter.get()); // 2

  // Capability + pipelining: цепочка без промежуточного await — один round trip.
  const first = await api.Catalog.counter().increment();
  console.log('07 pipelined capability →', first); // 1 (новый Counter)
})();