// Общие тривиальные сервисы — переиспользуются примерами от базовых к продвинутым.
// Объявления schema-first: тип метода выводится из фантомного $method.fn.

import { z } from 'zod';
import { fn, get, post } from '../../src';
import { stream } from './helpers/stream';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// RPC (fn): базовый jsonrpc, мультипротокол, форматы, websocket.
export class Math {
  constructor() {}
  static $add = fn({ in: z.object({ a: z.number(), b: z.number() }), out: z.number() });
  add: typeof Math.$add.fn = async (x) => x.a + x.b;

  static $count = fn({ in: z.number(), out: z.number(), desc: 'Инкремент' });
  count: typeof Math.$count.fn = async (n) => n + 1;
}

// REST (get/post): базовый rest, мультипротокол, formdata.
export class Catalog {
  constructor() {}
  static $getItem = get('/items/{item_id}', {
    query: z.object({ q: z.string().optional() }),
    resp: { 200: z.object({ id: z.string(), name: z.string() }) },
    desc: 'Получить предмет',
  });
  getItem: typeof Catalog.$getItem.fn = async ({ item_id, q }) => ({
    id: item_id,
    name: `item ${item_id}${q ? ` (${q})` : ''}`,
  });

  static $createItem = post('/items', {
    body: z.object({ name: z.string() }),
    resp: { 201: z.object({ id: z.string(), name: z.string() }) },
    status: 201,
  });
  createItem: typeof Catalog.$createItem.fn = async ({ name }) => ({ id: 'new', name });
}

// Echo + Date: форматы (devalue восстанавливает Date) и раннее извлечение тела.
export class Echo {
  constructor() {}
  static $echo = fn({ in: z.object({ msg: z.string() }), out: z.object({ msg: z.string() }) });
  echo: typeof Echo.$echo.fn = async (x) => x;

  static $now = fn({ in: z.unknown(), out: z.unknown() });
  now: typeof Echo.$now.fn = async () => new Date('2026-01-01T00:00:00Z');
}

// Stream: третий глагол (продвинутый).
export class Ticker {
  constructor() {}
  static $countdown = stream({
    in: z.object({ from: z.number() }),
    event: z.object({ n: z.number() }),
    desc: 'Обратный отсчёт',
  });
  countdown: typeof Ticker.$countdown.fn = async function* ({ from }) {
    try {
      for (let n = from; n > 0; n--) {
        yield { n };
        await delay(5);
      }
    } finally {
      console.log('countdown cleanup');
    }
  };

  static $ping = fn({ in: z.string(), out: z.string() });
  ping: typeof Ticker.$ping.fn = async (s) => `pong:${s}`;
}

// Capability-target (capnweb, продвинутый): инстанс возвращается по ссылке.
export class Counter {
  #value = 0;
  static $increment = fn({ in: z.void(), out: z.number() });
  increment: typeof Counter.$increment.fn = async () => ++this.#value;

  static $get = fn({ in: z.void(), out: z.number() });
  get: typeof Counter.$get.fn = async () => this.#value;
}