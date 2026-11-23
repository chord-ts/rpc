// v2 RPC-эндпоинт: импорт из опубликованного пакета (@chord/rpc → dist через exports-карту).
// Корень реэкспортит v1+v2; compose/fn/jsonrpc — v2-имена без суффикса версии.
import { compose, fn, jsonrpc, fromSvelteKit, RpcError } from '@chord/rpc';
import { ZodAdapter } from '@chord/rpc/schemas/zod';
import { z } from 'zod';

class Math {
  constructor() {}
  static $add = fn({
    in: z.object({ a: z.number(), b: z.number() }),
    out: z.number(),
    summary: 'Сложение',
    desc: 'Складывает два числа **a** и **b**.',
    tags: ['арифметика'],
    
  });
  add: typeof Math.$add.fn = async (x) => x.a + x.b;

  // Бизнес-ошибка: нативный RpcError со своим кодом и data долетает до клиента как есть.
  static $div = fn({ in: z.object({ a: z.number(), b: z.number() }), out: z.number(), summary: 'Деление', desc: 'Делит **a** на **b**; при b=0 бросает RpcError.' });
  div: typeof Math.$div.fn = async (x) => {
    if (x.b === 0) throw new RpcError(-32000, 'Division by zero', { a: x.a, b: x.b });
    return x.a / x.b;
  };

  // Обычный Error обработчика мапится протоколом в InternalError (-32603).
  static $sqrt = fn({ in: z.object({ x: z.number() }), out: z.number(), summary: 'Квадратный корень', desc: 'Корень из **x**; при x<0 бросает Error.' });
  sqrt: typeof Math.$sqrt.fn = async ({ x }) => {
    if (x < 0) throw new Error(`Negative input: ${x}`);
    return x ** 0.5;
  };

  // Массив как одно значение: обработчик получает массив целиком, клиент шлёт [[…]]
  // (proxy оборачивает одиночный array-аргумент). OpenRPC: дескриптор arg0 с array-схемой.
  static $sumAll = fn({ in: z.array(z.number()), out: z.number(), summary: 'Сумма массива', desc: 'Суммирует элементы массива (провод [[…]]).' });
  sumAll: typeof Math.$sumAll.fn = async (nums) => nums.reduce((a, b) => a + b, 0);
}

class Clock {
  constructor() {}
  static $now = fn({ in: z.void(), out: z.date() });
  now: typeof Clock.$now.fn = async () => new Date();
}

// Скалярные схемы: in/out — не объекты, а скаляры (string/number/boolean). Скаляр — вырожденный
// tuple из одного аргумента: OpenRPC даёт позиционный дескриптор arg0 + paramStructure 'by-position',
// стандартный провод — [value] (JSON-RPC §4.2 требует Structured params); chord-клиент шлёт голый
// скаляр (rpc.Scalars.upper('hello')) — сервер принимает обе формы. Try it в clef исполняет.
class Scalars {
  constructor() {}
  static $upper = fn({ in: z.string(), out: z.string(), summary: 'Верхний регистр', desc: 'Переводит строку в верхний регистр.', mcp: {} });
  upper: typeof Scalars.$upper.fn = async (s) => s.toUpperCase();

  static $double = fn({ in: z.number(), out: z.number(), summary: 'Удвоение', desc: 'Умножает число на 2.' });
  double: typeof Scalars.$double.fn = async (n) => n * 2;

  static $not = fn({ in: z.boolean(), out: z.boolean(), summary: 'Отрицание', desc: 'Логическое НЕ.' });
  not: typeof Scalars.$not.fn = async (b) => !b;

  // Несколько аргументов — tuple-схема: обработчик объявлен перечислением (text, times),
  // клиент шлёт by-position массив (rpc.Scalars.repeat('ab', 3)), core валидирует поэлементно;
  // optional-элемент → необязательный хвостовой аргумент. OpenRPC: дескриптор на элемент,
  // paramStructure: 'by-position' — полностью в рамках JSON-RPC 2.0 §4.2.
  static $repeat = fn({ in: z.tuple([z.string(), z.number()]), out: z.string() });
  repeat: typeof Scalars.$repeat.fn = async (text, times) => text.repeat(times);

  static $pad = fn({
    in: z.tuple([z.string(), z.number(), z.string().optional()]),
    out: z.string(),
  });
  pad: typeof Scalars.$pad.fn = async (text, width, fill) => text.padStart(width, fill ?? ' ');
}

// Simple-эндпоинты: публичные методы без $method — без валидации, params идут напрямую.
// Один параметр — одиночный вход; несколько — позиционный массив (клиент шлёт args массивом).
class Greeter {
  async echo(text: string) {
    return text;
  }
  async greet(greeting: string, name: string) {
    return `${greeting}, ${name}!`;
  }
}

// DI: имя параметра конструктора — ключ зависимости; inject берёт её из ctx (locals SvelteKit).
class Session {
  user: string;
  constructor(user: string) {
    this.user = user;
  }
  static $whoami = fn({ in: z.void(), out: z.string() });
  whoami: typeof Session.$whoami.fn = async () => this.user;
}

// ZodAdapter на уровне compose: вендорный адаптер сам конвертирует zod-типы (void/date → any
// через z.toJSONSchema unrepresentable:'any'). Генерация (rpc.discover, GET-спека) читает его.
// '_' префикс: SvelteKit разрешает только HTTP-хэндлеры/config/_-экспорты из +server.ts.
export const _composer = compose({ Math, Clock, Scalars, Greeter, Session }, {
  schemas: new ZodAdapter(),
  inject: { user: (ctx: App.Locals) => ctx.user },
});
const rpcEndpoint = jsonrpc(_composer);
export type ClientType = typeof rpcEndpoint;
export const POST = (event: { request: Request; locals: App.Locals }) => fromSvelteKit(rpcEndpoint, event);

