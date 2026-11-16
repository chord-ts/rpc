# Регистрация без декораторов + schema-first `fn` — детальный проект

> Черновик v2.0 по пунктам 1–2 из [`ROADMAP.md`](../ROADMAP.md). Итоговый API.
> Канонический пользовательский пример — [`example.ts`](./example.ts) (импортирует src).
> Библиотечная механика — в `src/` (`core`, `schemas`, …); типы проверены тестами `tests/v2`.

## Целевой API

```ts
import { z } from 'zod';
import { fn, compose, type Middleware } from '@chord-ts/rpc';

type Ctx = { user: { id: string; name: string } };

export class Say {
  // DI: фреймворк сам делает new Say(ctx), подставляя вычисленный контекст.
  constructor(public readonly ctx: Ctx) {}

  static $hello = fn({
    in: z.string(),
    out: z.string(),
    use: [logCalls],          // per-fn middleware
  });

  // Метод — поле-стрелка: тип функции берётся из $hello.fn, аргумент выводится сам.
  hello: typeof Say.$hello.fn = async (name) => {
    return `hello ${name}, logged in as ${this.ctx.user.name}`;
  };

  // Не эндпоинт.
  #greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

const composer = compose(
  { Say },
  { inject: { ctx: (event) => event.locals } },   // DI по имени параметра конструктора
);
```

## Главная идея: schema-first, метод выводится из схемы

`static $method = fn({ in, out, use })` — **единственный источник типов**. От него тип метода берётся
через фантомное поле `fn` (существует только на уровне типов, в рантайме его нет):

```ts
type Contract = {
  in: z.ZodTypeAny;
  out?: z.ZodTypeAny;
  use?: MaybeArray<Middleware>;
};

type ContractIn<C extends Contract> = z.infer<C['in']>;
type ContractOut<C extends Contract> = C['out'] extends z.ZodTypeAny ? z.infer<C['out']> : unknown;

// fn() возвращает контракт + фантомное поле `fn` с сигнатурой обработчика.
type Fn<C extends Contract> = C & {
  fn: (input: ContractIn<C>) => Promise<ContractOut<C>>;
};

function fn<C extends Contract>(c: C): Fn<C> {
  return c as unknown as Fn<C>;
}
```

Отсюда `hello: typeof Say.$hello.fn = async (name) => …` — имя аргумента и возврат выводятся из
типа функции (тот же приём, что `const realisation: Fn = (arg) => …`), рукописных типов нет.

Одно имя `fn` покрывает оба смысла: `fn({…})` — объявление, `$hello.fn` — тип.

### Следствие schema-first (важно)

`out` — единственное, что даёт тип возврата. Если `out` опущен, возврат становится **`unknown`**:
он не валидируется и не типизируется для клиента (`Client` отдаст `Promise<unknown>`). Поэтому:

- нужен типизированный возврат — указывай `out` (даже `z.any()`, если валидировать нечего);
- `out` опускают только для возвратов, которые клиент не потребляет (fire-and-forget, нотификации).

Это осознанный размен на схему как источник типов: раньше «out опущен → тип из метода», теперь
«out опущен → тип неизвестен». Прув поведения — в спайках.

## От чего мы отказываемся на самом деле

`emitDecoratorMetadata` даёт только строки имён типов (`design:paramtypes` → `['string']`), и их
единственный потребитель — `getSchema()`. Тип клиента и так выводился компилятором из переданного в
`init`; имена аргументов и так брались парсингом `fn.toString()`. Декораторы типов не несут — несут
лишь «тип-имя» для схемы, и это закрывается схемой, которая знает тип и в компайлтайме, и в рантайме.
`reflect-metadata` становится не нужен.

## Выведение Client из классов

```ts
type AnyCtor = new (...args: any[]) => any;
type ServiceMap = Record<string, AnyCtor>;

type MethodKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T];

type RemoteMethod<F> = F extends (...args: infer A) => infer R
  ? (...args: A) => Promise<Awaited<R>>
  : never;

type RemoteService<T> = { [K in MethodKeys<T>]: RemoteMethod<T[K]> };

type Client<S extends ServiceMap> = {
  [K in keyof S]: RemoteService<InstanceType<S[K]>>;
};
```

Ключевое — `InstanceType<S[K]>`: из класса достаём тип инстанса, дальше мапим методы. `Awaited<R>`
чинит ложь «тип `string`, а по факту Promise». Поля-стрелки (`hello`, `count`) видны через `keyof`,
а `#`/`private` — нет, поэтому в Client попадают только публичные процедуры.

## Какие методы — эндпоинты

Обход идёт по **прототипу** класса: все методы без `$метод` становятся **simple-эндпоинтами**, а
валидацию и типы даёт `$метод` (schema-first).

- Публичный метод класса без `$method` — **simple-эндпоинт**: тип из сигнатуры метода, рантайм-валидации
  нет (быстрое прототипирование).
- Публичное поле-стрелка со `static $method` — **schema-first-эндпоинт**: validate(in) → invoke →
  validate(out), тип из схемы.
- `#` (нативный приват) — невидим и в типах, и в рантайме. Канонично для хелперов. `private` (TS)
  стирается в рантайме и потому попал бы в simple-развёртку — для приватных хелперов используй `#`.

```ts
hello: typeof Say.$hello.fn = async (name) => this.#greet(name);   // schema-first
async noCheck(name: string) { return `Hello, ${name}`; }           // simple, без валидации

#greet(name: string): string { return `Hello, ${name}!`; }         // не эндпоинт
#helper(): string { return 'internal'; }                            // не эндпоинт
```

## Per-fn middleware

`use` принимает один middleware или массив — ровно там, где раньше был `@rpc({ use })`:

```ts
static $expensive = fn({
  in: expensiveInput,
  use: [cacheMiddleware(cache), auth(['admin'])],
});
```

Порядок — composer-мидлвари, затем per-fn `use` (см. [`v2-exec-pipeline.md`](./v2-exec-pipeline.md)).

## DI через конструктор

Зависимости объявляются в конструкторе, фреймворк вычисляет их из запроса и подставляет в `new
Say(...)`. Ключи `inject` совпадают с именами параметров конструктора (их читают тем же парсингом
`fn.toString()`, что и аргументы методов):

```ts
class Say {
  constructor(
    public readonly ctx: Ctx,
    public readonly logger: Logger,
  ) {}
}

compose({ Say }, {
  inject: {
    ctx: (event) => event.locals,
    logger: (event) => event.logger,
  },
});
```

Вычисление (фабрика `inject.*`) и хранение (`this.ctx`) разведены. Это ответ на «вычислять контекст
пользователя и хранить его в сервисе».

## Схема-агностичность

Ядро не зависит ни от одной библиотеки валидации — ни в core-типах, ни в `package.json`. Контракт
схемы — вендоренный минимум в духе Standard Schema:

```ts
interface AnySchema<Output = unknown> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate(
      value: unknown
    ): { readonly value: Output } | { readonly issues: readonly unknown[] };
  };
}

type InferOutput<S extends AnySchema> = S extends AnySchema<infer O> ? O : never;

type Contract = { in: AnySchema<any>; out?: AnySchema<any>; use?: MaybeArray<Middleware> };
type Out<C extends Contract> = C['out'] extends AnySchema<infer O> ? O : unknown;

type Fn<C extends Contract> = C & {
  fn: (input: InferOutput<C['in']>) => Promise<Out<C>>;
};
```

`fn` в ядре та же, что в zod-примере, только параметризована `AnySchema`. Метод выводит вход из
`$hello` существующим `InferOutput`. Любая библиотека, реализующая `~standard` (Standard Schema) —
zod 4 / Valibot / ArkType — принимается **напрямую**, без адаптера; zod 3 выпилен.

Тонкие шимы нужны только для библиотек без `~standard` (сейчас — `yup`): они живут за opt-in
entry-points (`@chord-ts/rpc/validators/yup`). Тот же адаптерный слой пригодится при генерации
OpenRPC/OpenAPI/MCP — как место конвертации схемы в JSON Schema для не-нативных библиотек.

## Закреплённые решения

1. Регистрация — **schema-first**: `static $method = fn({ in, out, use })`, метод выводится из `$hello`.
2. `in` — входная схема (любая: `z.object` для нескольких полей, скаляр для одного параметра).
3. `out` — если указан, валидируем и он задаёт тип возврата; если опущен — возврат `unknown`.
4. Тип метода — **фантомное `typeof Say.$hello.fn`**, методы пишутся как поля-стрелки.
5. Per-fn middleware — поле `use` (один или массив).
6. Не-эндпоинт — `#` (канонический) или `private` (только типы).
7. DI — через конструктор, ключи `inject` по именам параметров; зависимости — публичные
   parameter-properties (`public readonly`), типы `inject` выводятся из полей инстанса (`Injector<S>`).
8. Схема-агностичность — ядро на `AnySchema`, zod/valibot/arktype как opt-in адаптеры.
9. `description`/`deprecated`/`tags`/`meta` — вынесены из v1 `fn`; вернуть их как опциональные поля
   `Contract`, когда дойдём до генерации OpenRPC/OpenAPI/MCP.

## Осталось решить

- Разрешать ли `z.tuple([...])` как уступку старым позиционным вызовам, или только объект/скаляр.
- Перенос `zod` из `dependencies` в `optionalDependencies`/`devDependencies` (упаковка; тесты v2 уже
  гоняются на настоящем zod 4 через devDep-алиас `zod4`).