// Callable-декларация: `$method(handler)` контекстно типизирует обработчик и возвращает его как есть
// (identity). Аннотационный стиль (`m: typeof $m.fn = …`) сосуществует — обе формы рядом.

import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, stream, compose, ErrorCode, type Client } from '../index';
import { get, post, rest } from '@/rest';
import { envelope } from '../test-utils';

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

// Сосуществование: аннотация и callable в одном классе, обе регистрируются.
class Legacy {
  static $echo = fn({ in: z.string(), out: z.string() });
  echo: typeof Legacy.$echo.fn = async (s) => s;

  static $shout = fn({ in: z.string(), out: z.string() });
  shout = Legacy.$shout(async (s) => s.toUpperCase());
}

// Plain-object контракт (без fn) всё ещё регистрируется — guard принимает и object, и function.
class Plain {
  static $raw = { in: z.string(), out: z.string() };
  async raw(s: string) {
    return s;
  }
}

// REST: callable поверх get/post, части path/query/body и авто-path из шаблона.
class Catalog {
  static $getItem = get('/items/{item_id}', {
    query: z.object({ q: z.string().optional() }),
    resp: { 200: z.object({ id: z.string(), name: z.string() }) },
  });
  getItem = Catalog.$getItem(async ({ item_id, q }) => ({
    id: item_id,
    name: `item ${item_id}${q ? ` (${q})` : ''}`,
  }));

  static $createItem = post('/items', {
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

// Большая сигнатура: 8 позиционных аргументов, tuple с optional-хвостом — обе формы рядом.
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

class Analytics {
  static $report = fn({ in: reportIn, out: reportOut, desc: 'Сводный отчёт' });
  report = Analytics.$report(async (dataset, from, to, granularity, metrics, filters, limit, offset) => {
    const rows = metrics.map((metric) => ({ dataset, from, to, granularity, metric, ...filters }));
    return { rows: rows.slice(offset ?? 0, (offset ?? 0) + (limit ?? 10)), total: rows.length };
  });
}

class AnalyticsAnnotated {
  static $report = fn({ in: reportIn, out: reportOut, desc: 'Сводный отчёт' });
  report: typeof AnalyticsAnnotated.$report.fn = async (dataset, from, to, granularity, metrics, filters, limit, offset) => {
    const rows = metrics.map((metric) => ({ dataset, from, to, granularity, metric, ...filters }));
    return { rows: rows.slice(offset ?? 0, (offset ?? 0) + (limit ?? 10)), total: rows.length };
  };
}

// --- type-level прувы (Equal) — проверяются и tsc, и тестом ниже ---

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

const _helloArgs: Equal<Parameters<InstanceType<typeof Say>['hello']>, [string]> = true;
const _helloRet: Equal<ReturnType<InstanceType<typeof Say>['hello']>, Promise<string>> = true;
const _addArgs: Equal<Parameters<InstanceType<typeof Math>['add']>, [{ a: number; b: number }]> = true;
const _repeatArgs: Equal<Parameters<InstanceType<typeof Math>['repeat']>, [string, number]> = true;
const _sumAllArgs: Equal<Parameters<InstanceType<typeof Math>['sumAll']>, [number[]]> = true;
const _getItemArgs: Equal<
  Parameters<InstanceType<typeof Catalog>['getItem']>,
  [{ item_id: string } & { q?: string | undefined }]
> = true;
// Клиентская проекция: поле-обработчик остаётся функцией, Client выводит Promise<out>.
const _clientRet: Equal<ReturnType<Client<{ Say: typeof Say }>['Say']['hello']>, Promise<string>> = true;
// Большие сигнатуры: optional-хвост выводится полностью, формы дают идентичные типы.
const _reportArgs: Equal<
  Parameters<InstanceType<typeof Analytics>['report']>,
  [string, string, string, 'day' | 'week' | 'month', string[], Record<string, string>, (number | undefined)?, (number | undefined)?]
> = true;
const _reportSame: Equal<
  Parameters<InstanceType<typeof Analytics>['report']>,
  Parameters<InstanceType<typeof AnalyticsAnnotated>['report']>
> = true;

test('type-level proofs: callable и аннотация дают идентичные типы', () => {
  expect([
    _helloArgs,
    _helloRet,
    _addArgs,
    _repeatArgs,
    _sumAllArgs,
    _getItemArgs,
    _clientRet,
    _reportArgs,
    _reportSame,
  ]).toEqual(Array(9).fill(true));
});

// Guards: неверные обработчики отклоняются на этапе типов.
// @ts-expect-error — неверный тип аргумента
Say.$hello(async (name: number) => String(name));
// @ts-expect-error — неверный тип возврата
Say.$hello(async () => 42);
// @ts-expect-error — sync-обработчик (обработчики v2 всегда async)
Say.$hello((name) => `Hi ${name}`);
// @ts-expect-error — неверный тип yield-события
Ticker.$countdown(async function* () {
  yield { n: 'x' };
});
// @ts-expect-error — неверный тип path-параметра
Catalog.$getItem(async ({ item_id }: { item_id: number }) => ({ id: String(item_id), name: 'x' }));
// @ts-expect-error — limit должен быть number, не string (8-позиционная сигнатура)
Analytics.$report(async (_dataset, _from, _to, _granularity, _metrics, _filters, _limit: string) => {
  void _limit;
  return { rows: [], total: 0 };
});

test('declaration is a callable function carrying the contract; fn stays phantom', () => {
  expect(typeof Say.$hello).toBe('function');
  const handler = async (name: string) => name;
  expect(Say.$hello(handler)).toBe(handler); // identity
  const decl = Say.$hello as unknown as Record<string, unknown>;
  expect(decl.in).toBeTruthy();
  expect(decl.out).toBeTruthy();
  expect(decl.desc).toBe('Greets');
  expect('fn' in decl).toBe(false);
  // REST-декларация тоже callable и несёт rest-мету.
  expect(typeof Catalog.$getItem).toBe('function');
  expect((Catalog.$getItem as unknown as { rest: { endpoint: string } }).rest.endpoint).toBe('/items/{item_id}');
});

const exec = envelope({ Say, Math, Legacy, Plain }, {});

test('compose registers callable declarations; wire calls work', async () => {
  expect(await exec({ method: 'Say.hello', params: ['Ada'], id: 1 })).toMatchObject({ result: 'Hello, Ada!' });
  expect(await exec({ method: 'Math.add', params: { a: 2, b: 3 }, id: 2 })).toMatchObject({ result: 5 });
  expect(await exec({ method: 'Math.repeat', params: ['ab', 3], id: 3 })).toMatchObject({ result: 'ababab' });
  expect(await exec({ method: 'Math.sumAll', params: [[1, 2, 3]], id: 4 })).toMatchObject({ result: 6 });
  expect(await exec({ method: 'Legacy.echo', params: ['coexist'], id: 5 })).toMatchObject({ result: 'coexist' });
  expect(await exec({ method: 'Legacy.shout', params: ['coexist'], id: 6 })).toMatchObject({ result: 'COEXIST' });
  expect(await exec({ method: 'Plain.raw', params: ['object-contract'], id: 7 })).toMatchObject({ result: 'object-contract' });
});

test('input validation still enforced through the contract on the function', async () => {
  const res = await exec({ method: 'Math.add', params: { a: 'x', b: 3 }, id: 9 });
  expect(res.error.code).toBe(ErrorCode.InvalidParams);
});

test('void input and DI-this through callable arrows', async () => {
  const c = compose({ Math });
  expect(await c.call('Math.ping', undefined)).toBe('pong');

  const s = compose({ Session }, { inject: { user: (ctx: { name: string }) => ctx.name } });
  expect(await s.call('Session.whoami', undefined, { ctx: { name: 'ada' } })).toBe('ada');
});

test('REST callable: slices validated, status map honoured', async () => {
  const api = rest(compose({ Catalog }));
  const got = await api.http.handle({ method: 'GET', url: 'http://localhost/items/42?q=widget', body: {} });
  expect(got.status).toBe(200);
  expect(got.body).toEqual({ id: '42', name: 'item 42 (widget)' });

  const created = await api.http.handle({ method: 'POST', url: 'http://localhost/items', body: { name: 'widget' } });
  expect(created.status).toBe(201);
  expect(created.body).toEqual({ id: 'new', name: 'widget' });

  const bad = await api.http.handle({ method: 'POST', url: 'http://localhost/items', body: { name: 42 } });
  expect(bad.status).toBe(422);
});

test('stream callable: bare events in order', async () => {
  const c = compose({ Ticker });
  const events: unknown[] = [];
  for await (const e of c.stream('Ticker.countdown', { from: 3 })) events.push(e);
  expect(events).toEqual([{ n: 3 }, { n: 2 }, { n: 1 }]);
});

test('big signatures: 8 positional args with optional tail, both forms identical at runtime', async () => {
  const c = compose({ Analytics, AnalyticsAnnotated });
  const reportArgs = ['sales', '2026-01-01', '2026-01-31', 'week', ['revenue', 'orders'], { region: 'eu' }, 2, 0];
  const full = await c.call('Analytics.report', reportArgs);
  expect(full).toEqual(await c.call('AnalyticsAnnotated.report', reportArgs));
  expect((full as { total: number }).total).toBe(2);

  const short = await c.call('Analytics.report', ['sales', '2026-01-01', '2026-01-31', 'week', ['revenue'], {}]);
  expect((short as { total: number }).total).toBe(1);
});

test('protocol-mix guard still fires with callable declarations', () => {
  class Mixed {
    static $item = get('/items', { resp: { 200: z.object({}) } });
    item = Mixed.$item(async () => ({}));
    static $count = fn({ in: z.number(), out: z.number() });
    count = Mixed.$count(async (n) => n + 1);
  }
  expect(() => compose({ Mixed })).toThrow(/mixes REST/);
});
