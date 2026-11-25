// Спайк: callable-декларация — `hello = Say.$hello(async (name) => …)` вместо аннотации
// `hello: typeof Say.$hello.fn = …`. Форма НЕ утверждена, src не тронут.
// Механика локальная (fn/stream/get обёртки + мини-регистрация), типы — реальные из src.
// Идея: декларация $method остаётся единственным источником типов; вызов $method(handler)
// контекстно типизирует обработчик и возвращает его как есть (identity). Аннотационный
// стиль сосуществует. Рантайм-декларация становится функцией со свойствами контракта —
// единственный патч в src при переносе: guard buildRoutes принимает typeof 'function'.
// Проверка: npx tsc -p design/examples/tsconfig.json (дефолтный для design-примеров)

import { z } from 'zod';
import { get, post, type RestContract } from '../../src/rest';
import type { Contract, StreamContract, Fn, StreamFn, Client, AnyCtor } from '../../src/core/types';

// --- механика спайка (зеркало будущего src) ---

type Handler<C extends Contract> = Fn<C>['fn'];
type CallableFn<C extends Contract> = Fn<C> & { (handler: Handler<C>): Handler<C> };

function fn<C extends Contract>(c: C): CallableFn<C> {
  const bind = (handler: Handler<C>): Handler<C> => handler;
  return Object.assign(bind, c) as unknown as CallableFn<C>;
}

type StreamHandler<C extends StreamContract> = StreamFn<C>['fn'];
type CallableStream<C extends StreamContract> = StreamFn<C> & { (handler: StreamHandler<C>): StreamHandler<C> };

function stream<C extends StreamContract>(c: C): CallableStream<C> {
  const bind = (handler: StreamHandler<C>): StreamHandler<C> => handler;
  return Object.assign(bind, c) as unknown as CallableStream<C>;
}

// REST-сахар: та же callable-форма поверх реальных get/post (тип RestFn не экспортирован — выводим).
type Callable<D extends { fn: unknown }> = D & { (handler: D['fn']): D['fn'] };
function callable<D extends { fn: unknown }>(decl: D): Callable<D> {
  return Object.assign((handler: D['fn']) => handler, decl) as Callable<D>;
}
const get2 = <P extends string, C extends RestContract>(endpoint: P, c: C) => callable(get(endpoint, c));
const post2 = <P extends string, C extends RestContract>(endpoint: P, c: C) => callable(post(endpoint, c));

// --- пользовательский код: предложенный паттерн ---

class Say {
  static $hello = fn({ in: z.string(), out: z.string(), desc: 'Greets' });
  hello = Say.$hello(async (name) => `Hello, ${name}!`);
}

class Math {
  static $add = fn({ in: z.object({ a: z.number(), b: z.number() }), out: z.number() });
  add = Math.$add(async ({ a, b }) => a + b);

  static $repeat = fn({ in: z.tuple([z.string(), z.number()]), out: z.string() });
  repeat = Math.$repeat(async (text, times) => text.repeat(times));

  static $sumAll = fn({ in: z.array(z.number()), out: z.number() });
  sumAll = Math.$sumAll(async (nums) => nums.reduce((a, b) => a + b, 0));

  static $ping = fn({ in: z.void(), out: z.string() });
  ping = Math.$ping(async () => 'pong');
}

// DI: this инстанса доступен в стрелке, параметр конструктора — ключ зависимости.
class Session {
  constructor(public readonly user: string) {}
  static $whoami = fn({ in: z.void(), out: z.string() });
  whoami = Session.$whoami(async () => this.user);
}

// REST: части path/query/body, авто-path из шаблона.
class Catalog {
  static $getItem = get2('/items/{item_id}', {
    query: z.object({ q: z.string().optional() }),
    resp: { 200: z.object({ id: z.string(), name: z.string() }) },
  });
  getItem = Catalog.$getItem(async ({ item_id, q }) => ({
    id: item_id,
    name: `item ${item_id}${q ? ` (${q})` : ''}`,
  }));

  static $createItem = post2('/items', {
    body: z.object({ name: z.string() }),
    resp: { 201: z.object({ id: z.string(), name: z.string() }) },
    status: 201,
  });
  createItem = Catalog.$createItem(async ({ name }) => ({ id: 'new', name }));
}

// Stream: async-генератор, контекстный тип события из event.
class Ticker {
  static $countdown = stream({ in: z.object({ from: z.number() }), event: z.object({ n: z.number() }) });
  countdown = Ticker.$countdown(async function* ({ from }) {
    for (let n = from; n > 0; n--) yield { n };
  });
}

// Сосуществование: аннотационный стиль работает и с callable-декларацией.
class Legacy {
  static $echo = fn({ in: z.string(), out: z.string() });
  echo: typeof Legacy.$echo.fn = async (s) => s;
}

// --- Большие методы: две формы рядом, прочувствовать разницу ---

// Отчёт: 8 позиционных аргументов, tuple с optional-хвостом (limit/offset).
const reportIn = z.tuple([
  z.string(), // dataset
  z.string(), // from (ISO date)
  z.string(), // to
  z.enum(['day', 'week', 'month']), // granularity
  z.array(z.string()), // metrics
  z.record(z.string(), z.string()), // filters
  z.number().optional(), // limit
  z.number().optional(), // offset
]);
const reportOut = z.object({ rows: z.array(z.record(z.string(), z.unknown())), total: z.number() });

// Callable: обработчик — аргумент вызова декларации, сигнатура не пишется вообще.
class Analytics {
  static $report = fn({ in: reportIn, out: reportOut, desc: 'Сводный отчёт' });
  report = Analytics.$report(async (dataset, from, to, granularity, metrics, filters, limit, offset) => {
    const rows = metrics.map((metric) => ({ dataset, from, to, granularity, metric, ...filters }));
    return { rows: rows.slice(offset ?? 0, (offset ?? 0) + (limit ?? 10)), total: rows.length };
  });
}

// Аннотация: та же сигнатура, но перед обработчиком — typeof-аннотация источника типов.
class AnalyticsAnnotated {
  static $report = fn({ in: reportIn, out: reportOut, desc: 'Сводный отчёт' });
  report: typeof AnalyticsAnnotated.$report.fn = async (dataset, from, to, granularity, metrics, filters, limit, offset) => {
    const rows = metrics.map((metric) => ({ dataset, from, to, granularity, metric, ...filters }));
    return { rows: rows.slice(offset ?? 0, (offset ?? 0) + (limit ?? 10)), total: rows.length };
  };
}

// Заказ: крупный объектный вход с вложенностью и optional-полями.
const orderIn = z.object({
  customerId: z.string(),
  items: z.array(z.object({ sku: z.string(), qty: z.number(), price: z.number() })),
  shipping: z.object({ country: z.string(), city: z.string(), street: z.string(), zip: z.string() }),
  payment: z.object({ method: z.enum(['card', 'invoice']), currency: z.string() }),
  notify: z.boolean(),
  comment: z.string().optional(),
  coupon: z.string().optional(),
});
const orderOut = z.object({ orderId: z.string(), total: z.number(), status: z.enum(['pending', 'paid']) });

class Orders {
  static $create = fn({ in: orderIn, out: orderOut });
  create = Orders.$create(async ({ customerId, items, shipping, payment, coupon }) => {
    const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
    return {
      orderId: `${customerId}-${shipping.zip}`,
      total: coupon ? subtotal * 0.9 : subtotal,
      status: payment.method === 'card' ? 'paid' : 'pending',
    };
  });
}

class OrdersAnnotated {
  static $create = fn({ in: orderIn, out: orderOut });
  create: typeof OrdersAnnotated.$create.fn = async ({ customerId, items, shipping, payment, coupon }) => {
    const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
    return {
      orderId: `${customerId}-${shipping.zip}`,
      total: coupon ? subtotal * 0.9 : subtotal,
      status: payment.method === 'card' ? 'paid' : 'pending',
    };
  };
}

// --- type-level прувы ---

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

const _helloArgs: Equal<Parameters<InstanceType<typeof Say>['hello']>, [string]> = true;
const _helloRet: Equal<ReturnType<InstanceType<typeof Say>['hello']>, Promise<string>> = true;
const _addArgs: Equal<Parameters<InstanceType<typeof Math>['add']>, [{ a: number; b: number }]> = true;
const _repeatArgs: Equal<Parameters<InstanceType<typeof Math>['repeat']>, [string, number]> = true;
const _sumAllArgs: Equal<Parameters<InstanceType<typeof Math>['sumAll']>, [number[]]> = true;
const _getItemArgs: Equal<Parameters<InstanceType<typeof Catalog>['getItem']>, [{ item_id: string } & { q?: string | undefined }]> = true;
// Клиентская проекция: поле-стрелка остаётся функцией, Client выводит Promise<out>.
const _clientRet: Equal<ReturnType<Client<{ Say: typeof Say }>['Say']['hello']>, Promise<string>> = true;
// Большие сигнатуры: tuple с optional-хвостом выводится полностью, формы дают идентичные типы.
const _reportArgs: Equal<
  Parameters<InstanceType<typeof Analytics>['report']>,
  [string, string, string, 'day' | 'week' | 'month', string[], Record<string, string>, (number | undefined)?, (number | undefined)?]
> = true;
const _reportSame: Equal<
  Parameters<InstanceType<typeof Analytics>['report']>,
  Parameters<InstanceType<typeof AnalyticsAnnotated>['report']>
> = true;
const _orderSame: Equal<
  Parameters<InstanceType<typeof Orders>['create']>,
  Parameters<InstanceType<typeof OrdersAnnotated>['create']>
> = true;

// Guards: неверные обработчики отклоняются на этапе типов.
// @ts-expect-error — неверный тип аргумента
Say.$hello(async (name: number) => String(name));
// @ts-expect-error — неверный тип возврата
Say.$hello(async (name) => 42);
// @ts-expect-error — sync-обработчик (обработчики v2 всегда async)
Say.$hello((name) => `Hi ${name}`);
// @ts-expect-error — неверный тип yield-события
Ticker.$countdown(async function* () {
  yield { n: 'x' };
});
// @ts-expect-error — неверный тип path-параметра
Catalog.$getItem(async ({ item_id }: { item_id: number }) => ({ id: String(item_id), name: 'x' }));
// @ts-expect-error — limit должен быть number, не string (8-позиционная сигнатура)
Analytics.$report(async (dataset, from, to, granularity, metrics, filters, limit: string) => ({ rows: [], total: 0 }));
// @ts-expect-error — items.qty должен быть number, не string (вложенность большого объекта)
Orders.$create(async ({ items }: { items: { sku: string; qty: string; price: number }[] }) => ({ orderId: 'x', total: 0, status: 'pending' }));

// --- рантайм-механика: регистрация и вызов (зеркало core c function-guard) ---

// Единственное отличие от src/core buildRoutes: typeof 'function' тоже контракт.
function discover(Ctor: AnyCtor): string[] {
  const routes: string[] = [];
  for (const [key, contract] of Object.entries(Ctor as unknown as Record<string, unknown>)) {
    if (!key.startsWith('$')) continue;
    if ((typeof contract !== 'object' && typeof contract !== 'function') || contract === null || !('in' in contract)) continue;
    routes.push(key.slice(1));
  }
  return routes;
}

// Мини-invoke: те же правила провода, что в core.invoke (позиционные/unwrap/одиночное значение).
async function invoke(Ctor: AnyCtor, method: string, params: unknown, deps: unknown[] = []): Promise<unknown> {
  const decl = (Ctor as unknown as Record<string, { in: { '~standard': { validate(v: unknown): Promise<{ value: unknown } | { issues: unknown[] }> } } }>)[`$${method}`];
  let parsed = await decl.in['~standard'].validate(params);
  let positional = Array.isArray(params);
  if ('issues' in parsed && Array.isArray(params) && params.length === 1) {
    const unwrapped = await decl.in['~standard'].validate(params[0]);
    if (!('issues' in unwrapped)) {
      parsed = unwrapped;
      positional = false;
    }
  }
  if ('issues' in parsed) throw new Error('Validation error');
  const instance = new Ctor(...deps) as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const handler = instance[method];
  return positional && Array.isArray(parsed.value)
    ? handler.call(instance, ...parsed.value)
    : handler.call(instance, parsed.value);
}

export async function run(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  out.routesSay = discover(Say);
  out.routesMath = discover(Math);
  out.routesCatalog = discover(Catalog);
  out.routesTicker = discover(Ticker);
  out.declIsFunction = typeof Say.$hello === 'function';
  out.declKeepsContract = Say.$hello.desc === 'Greets' && 'in' in Say.$hello && 'out' in Say.$hello;
  out.hello = await invoke(Say, 'hello', 'Ada');
  out.add = await invoke(Math, 'add', { a: 2, b: 3 });
  out.repeat = await invoke(Math, 'repeat', ['ab', 3]);
  out.sumAll = await invoke(Math, 'sumAll', [[1, 2, 3]]);
  out.ping = await invoke(Math, 'ping', undefined);
  out.whoami = await invoke(Session, 'whoami', undefined, ['ada']);
  out.getItem = await invoke(Catalog, 'getItem', { path: { item_id: '42' }, query: { q: 'widget' }, body: {} });
  out.createItem = await invoke(Catalog, 'createItem', { path: {}, query: {}, body: { name: 'widget' } });
  out.legacyEcho = await invoke(Legacy, 'echo', 'coexist');
  // Большие методы: 8 позиционных аргументов, optional-хвост, крупный объект — обе формы.
  const reportArgs = ['sales', '2026-01-01', '2026-01-31', 'week', ['revenue', 'orders'], { region: 'eu' }, 2, 0];
  out.report = await invoke(Analytics, 'report', reportArgs);
  out.reportAnnotated = await invoke(AnalyticsAnnotated, 'report', reportArgs);
  out.reportShort = await invoke(Analytics, 'report', ['sales', '2026-01-01', '2026-01-31', 'week', ['revenue'], {}]);
  const orderParams = {
    customerId: 'c1',
    items: [{ sku: 'a', qty: 2, price: 10 }],
    shipping: { country: 'DE', city: 'Berlin', street: 'Unter den Linden', zip: '10117' },
    payment: { method: 'card', currency: 'EUR' },
    notify: true,
  };
  out.order = await invoke(Orders, 'create', orderParams);
  out.orderAnnotated = await invoke(OrdersAnnotated, 'create', orderParams);
  const events: unknown[] = [];
  const ticker = new Ticker();
  for await (const e of ticker.countdown({ from: 3 }, new AbortController().signal)) events.push(e);
  out.countdown = events;
  // Валидация входа всё так же работает через контракт на функции.
  try {
    await invoke(Math, 'add', { a: 'x', b: 3 });
    out.validation = 'MISSED';
  } catch (e) {
    out.validation = (e as Error).message;
  }
  return out;
}
