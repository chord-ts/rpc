// Protocol-agnostic core (the gasket). Imports only the shared types layer — zero vendor
// deps, no knowledge of protocol/transport/format/generation. JSON-RPC envelope (exec),
// REST sugar and agent tools live in upper layers and build on call/notify/endpoints.

import {
  CoreError,
  type AnyCtor,
  type Call,
  type ComposeOptions,
  type Contract,
  type Core,
  type DepKeys,
  type Endpoint,
  type Fn,
  type Handler,
  type Instantiated,
  type MethodDesc,
  type Middleware,
  type ServiceMap,
  type StreamContract,
  type StreamFn,
  type StreamHandler,
  type StreamOpts,
} from './types';
// Generic (dep-free) schema adapter — used only to classify array inputs at compose. schemas has
// no runtime import of core, so this adds no cycle and keeps core vendor-neutral.
import { defaultSchemas } from '@/schemas';

// The declaration is a callable function carrying the contract as own enumerable fields.
// defineProperty, not Object.assign: a function's `name`/`length` are non-writable — [[Set]]
// would throw on a contract carrying them; defineProperty redefines (they are configurable).
function callable<F extends (...args: never[]) => unknown, C extends object>(bind: F, c: C): F & C {
  for (const key of Object.keys(c)) {
    Object.defineProperty(bind, key, {
      value: (c as Record<string, unknown>)[key],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return bind as F & C;
}

/**
 * Declares a procedure from a schema. `$method.fn` is the phantom handler type:
 * the argument is inferred from `in`, the return from `out` (unknown when omitted).
 * The declaration is callable: `$method(handler)` contextually types the handler and returns
 * it as-is; the annotation style (`m: typeof $m.fn = …`) coexists with it.
 */
export function fn<C extends Contract>(c: C): Fn<C> {
  return callable((handler: Handler<C>) => handler, c) as unknown as Fn<C>;
}

/**
 * Declares a stream endpoint: `$method.fn` — async-генератор (input, signal) → события.
 * Тип аргумента из `in`, тип события из `event`. Отмена нативная (signal / return() итератора).
 * Callable-форма та же: `$method(handler)` типизирует генератор и возвращает его как есть.
 */
export function stream<C extends StreamContract>(c: C): StreamFn<C> {
  return callable((handler: StreamHandler<C>) => handler, c) as unknown as StreamFn<C>;
}

// Dependency keys match constructor parameter names (parsing ctor.toString()).
// Locate `constructor(` specifically — the first '(' may belong to a static fn() field
// when the class has no explicit constructor (then there are no deps → []).
// Minified bundles mangle parameter names — depKeys() then falls back to the explicit
// `static $constructor` annotation; compose guards and points to it on mismatch.
export function paramNames(ctor: AnyCtor): string[] {
  const src: string = ctor.toString();
  const idx = src.indexOf('constructor(');
  if (idx === -1) return [];
  const start = idx + 'constructor('.length;
  const head = src.slice(start, src.indexOf(')', start));
  return head.match(/([^\s,]+)/g) ?? [];
}

// DI keys: explicit `static $constructor = ['user', ...]` wins over parameter-name parsing.
// String literals survive minification, parameter names don't. The annotation is optional —
// users write it only when the compose-time guard reports a mangled-name mismatch.
function depKeys(ctor: AnyCtor): string[] {
  const explicit = (ctor as { $constructor?: unknown }).$constructor;
  return Array.isArray(explicit) ? (explicit as string[]) : paramNames(ctor);
}

// Endpoints come from `static $method = fn({...})` (schema-first; the declaration is a callable
// function carrying the contract fields) and from public prototype methods without `$method`
// (simple, no validation). Plain-object contracts are accepted too.
function buildRoutes<S extends ServiceMap>(services: S): Map<string, MethodDesc> {
  const routes = new Map<string, MethodDesc>();
  for (const [service, Ctor] of Object.entries(services)) {
    // Класс протокол-согласован: либо REST (get/post, contract.rest), либо RPC (fn/stream).
    // Смешивать стили в одном классе нельзя — разнесите по разным сервисам.
    let hasRest = false;
    let hasRpc = false;
    for (const [key, contract] of Object.entries(Ctor)) {
      if (
        !key.startsWith('$') ||
        (typeof contract !== 'object' && typeof contract !== 'function') ||
        contract === null ||
        !('in' in contract)
      ) {
        continue;
      }
      if ((contract as { rest?: unknown }).rest) hasRest = true;
      else hasRpc = true;
      // Handler presence is verified by warnMissingHandlers (probe instance) at compose;
      // invoke also guards at call time. Arrow-field handlers aren't on the prototype.
      const method = key.slice(1);
      routes.set(`${service}.${method}`, {
        service,
        method,
        contract: contract as Contract,
        use: Array.isArray(contract.use) ? contract.use : contract.use ? [contract.use] : [],
      });
    }
    if (hasRest && hasRpc) {
      throw new Error(
        `[chord] ${service}: mixes REST (get/post) and RPC (fn/stream) declarations in one class — split them into separate services`,
      );
    }

    // Регистрируем отдельно методы без описания. Только callable-методы прототипа: геттеры/сеттеры
    // и data-поля эндпоинтами не становятся (геттер иначе исполнялся бы при чтении instance[method]).
    const proto = (Ctor as AnyCtor).prototype;
    for (const method of Object.getOwnPropertyNames(proto)) {
      if (method === 'constructor' || routes.has(`${service}.${method}`)) continue;
      const d = Object.getOwnPropertyDescriptor(proto, method);
      if (!d || typeof d.value !== 'function') continue;
      routes.set(`${service}.${method}`, { service, method, contract: null, use: [] });
    }
  }
  return routes;
}

// DX warning: a `$method` schema declared without a matching handler. Arrow-field handlers are
// instance properties (not on the prototype), so verify via a probe instance with a permissive
// dummy ctx. Best-effort: if deps need a real ctx the probe fails silently — invoke still guards.
function warnMissingHandlers<S extends ServiceMap>(
  services: S,
  routes: Map<string, MethodDesc>,
  inject: Record<string, (ctx: any) => any>,
): void {
  const dummy: any = new Proxy(function () {}, { get: () => dummy, apply: () => dummy });
  for (const [service, Ctor] of Object.entries(services)) {
    try {
      const deps = depKeys(Ctor as AnyCtor).map((name) => inject[name]?.(dummy));
      const instance = new (Ctor as AnyCtor)(...deps);
      for (const [key, desc] of routes) {
        if (desc.service !== service || !desc.contract) continue;
        if (typeof instance[desc.method] !== 'function') {
          console.warn(`[chord] ${key}: schema $${desc.method} declared but handler "${desc.method}" is missing on ${service}`);
        }
      }
    } catch {
      // probe needs a real ctx — skip; call-time guard remains
    }
  }
}

function runChain(
  ctx: unknown,
  middlewares: Middleware[],
  terminal: (ctx: unknown) => Promise<unknown>
): Promise<unknown> {
  const dispatch = (i: number) => (c: unknown): Promise<unknown> =>
    i < middlewares.length ? middlewares[i](c, dispatch(i + 1)) : terminal(c);
  return dispatch(0)(ctx);
}

/** Registers services and returns the protocol-agnostic gasket.
 * options опциональны только для сервисов без зависимостей: `compose({ Service })`. Если у сервисов
 * есть DI-ключи (DepKeys), options обязателен (inject нельзя обойти опусканием всего параметра). */
export function compose<S extends ServiceMap>(
  services: S,
  ...args: [DepKeys<S>] extends [never] ? [options?: ComposeOptions<S>] : [options: ComposeOptions<S>]
): Core<S> {
  const options = args[0];
  const inject = (options?.inject ?? {}) as unknown as Record<string, (ctx: any) => any>;
  const use = options?.use;
  const composerMiddlewares: Middleware[] = Array.isArray(use) ? use : use ? [use] : [];
  const validateOut = options?.validateOut ?? false;
  const routes = buildRoutes(services);

  // Classify array inputs once: tuple (prefixItems) → positional args; plain array → a single
  // array value. Lets a standard JSON-RPC client's bare [1,2,3] reach an array-schema handler as
  // one argument instead of being spread. Unclassifiable schemas keep the bare-array heuristic.
  const classifier = options?.schemas ?? defaultSchemas;
  for (const desc of routes.values()) {
    if (!desc.contract) continue;
    try {
      const json = classifier.jsonSchema(desc.contract.in) as { type?: string; prefixItems?: unknown[] };
      if (json && json.type === 'array') desc.positional = Array.isArray(json.prefixItems);
    } catch {
      // no converter / synthetic schema → fall back at call time
    }
  }

  // Fail fast at compose (not first request): a resolved dep key without an inject factory
  // is almost always a minified bundle mangling constructor parameter names. The error
  // points to the optional `static $constructor` annotation instead of an opaque TypeError.
  for (const [service, Ctor] of Object.entries(services)) {
    for (const name of depKeys(Ctor as AnyCtor)) {
      if (typeof inject[name] !== 'function') {
        const keys = Object.keys(inject);
        throw new Error(
          `[chord] ${service}: no inject factory for dependency "${name}" (from constructor parameter names). ` +
            `Minifiers mangle parameter names — if this bundle is minified, add explicit keys to the class: ` +
            `static $constructor = ['key1', 'key2'] (inject keys in constructor parameter order). ` +
            `Available inject keys: ${keys.length ? keys.join(', ') : '(none)'}`,
        );
      }
    }
  }

  warnMissingHandlers(services, routes, inject);
  const registry: Endpoint[] = [...routes.values()].map((d) => ({
    service: d.service,
    method: d.method,
    contract: d.contract as (Contract & Record<string, unknown>) | null,
  }));

  function instantiate(ctx: unknown): Instantiated<S> {
    const built: Record<string, unknown> = {};
    for (const key of Object.keys(services) as (keyof S)[]) {
      const Ctor = services[key] as AnyCtor;
      const deps = depKeys(Ctor).map((name) => inject[name](ctx));
      built[key as string] = new Ctor(...deps);
    }
    return built as Instantiated<S>;
  }

  // Нативные ошибки: свои сбои (not found, валидация) — CoreError (протокол-нейтральная);
  // ошибки обработчика летят как есть (биндинги мапят их в свой провод).
  async function invoke(desc: MethodDesc, params: unknown, ctx: unknown): Promise<unknown> {
    const Ctor = services[desc.service] as AnyCtor;
    const deps = depKeys(Ctor).map((name) => inject[name](ctx));
    const instance = new Ctor(...deps);
    const handler = instance[desc.method];

    if (typeof handler !== 'function') {
      throw new CoreError('not-found', `Method not found: ${desc.service}.${desc.method}`);
    }

    if (desc.contract) {
      let parsedIn = await desc.contract.in['~standard'].validate(params);
      // Проводной контракт (JSON-RPC §4.2): tuple → позиционные [a, b]; массив-как-значение →
      // [[…]] или голый […] (один аргумент-массив); скаляр → [value] или голый (chord-клиент).
      let positional = Array.isArray(params) && desc.positional !== false;
      if ('issues' in parsedIn && Array.isArray(params) && params.length === 1) {
        // Невалидный одиночный массив распаковываем в значение (если обе формы невалидны —
        // ошибка от прямой).
        const unwrapped = await desc.contract.in['~standard'].validate(params[0]);
        if (!('issues' in unwrapped)) {
          parsedIn = unwrapped;
          positional = false;
        }
      } else if (desc.positional === false && Array.isArray(params) && params.length === 1 && Array.isArray(params[0])) {
        // Обёрнутая форма [[…]] — каноническая для array-схемы (chord-клиент всегда оборачивает),
        // поэтому выигрывает даже когда внешняя форма тоже валидна (z.array(z.unknown())).
        // Трейдофф: голый [['x']] как массив-массивов с unknown-элементами неотличим от обёртки.
        const unwrapped = await desc.contract.in['~standard'].validate(params[0]);
        if (!('issues' in unwrapped)) {
          parsedIn = unwrapped;
          positional = false;
        }
      } else if ('issues' in parsedIn && !Array.isArray(params) && params !== undefined) {
        // Голый скаляр для 1-кортежа (z.tuple([z.string()])): пробуем позиционную форму [value].
        const wrapped = await desc.contract.in['~standard'].validate([params]);
        if (!('issues' in wrapped)) {
          parsedIn = wrapped;
          positional = true;
        }
      }
      if ('issues' in parsedIn) {
        throw new CoreError('invalid-params', 'Validation error', parsedIn.issues);
      }

      // .call(instance): обработчик может быть методом прототипа (не стрелкой) — this = инстанс.
      const value =
        positional && Array.isArray(parsedIn.value)
          ? await handler.call(instance, ...parsedIn.value)
          : await handler.call(instance, parsedIn.value);

      // out всегда задаёт тип возврата; рантайм-проверка — только по флагу validateOut.
      if (desc.contract.out && validateOut) {
        const parsedOut = await desc.contract.out['~standard'].validate(value);
        if ('issues' in parsedOut) {
          throw new CoreError('invalid-output', 'Response validation error', parsedOut.issues);
        }
        return parsedOut.value;
      }

      return value;
    }

    // Simple endpoint (no schema): pass params straight to the handler.
    // Позиционный контракт: [value] → один аргумент (стандартный JSON-RPC клиент), [[…]] →
    // массив-как-значение (chord-клиент); голый многоэлементный […] — значение для 1-аргументного.
    return handler.length <= 1
      ? handler.call(instance, Array.isArray(params) && params.length === 1 ? params[0] : params)
      : Array.isArray(params)
        ? handler.call(instance, ...params)
        : handler.call(instance, params);
  }

  async function dispatch(call: Call, ctx: unknown): Promise<unknown> {
    const desc = routes.get(call.method);
    if (!desc) {
      throw new CoreError('not-found', `Method not found: ${call.method}`);
    }
    if (desc.contract?.event) {
      throw new CoreError('invalid-params', `Method ${call.method} is a stream — use stream() instead`);
    }
    const terminal = (c: unknown) => invoke(desc, call.params, c);
    return runChain(ctx, [...composerMiddlewares, ...desc.use], terminal);
  }

  // Третий глагол: голые события + нативные ошибки. Валидация входа и каждого события;
  // отмена gasket-enforced (signal.aborted → AbortError), return()/break потребителя →
  // finally-cleanup генератора. Middleware (compose.use + contract.use) применяется onion'ом
  // вокруг iterable: guard исполняется до итерации (авторизация защищает и стримы).
  async function* stream(method: string, params: unknown, opts?: StreamOpts): AsyncIterable<unknown> {
    const desc = routes.get(method);
    if (!desc || !desc.contract?.event) {
      throw new CoreError('not-found', `Not a stream method: ${method}`);
    }
    const eventSchema = desc.contract.event;
    const signal = opts?.signal ?? new AbortController().signal;
    const iterable = (await runChain(opts?.ctx ?? {}, [...composerMiddlewares, ...desc.use], async (c) => {
      const parsedIn = await desc.contract!.in['~standard'].validate(params);
      if ('issues' in parsedIn) {
        throw new CoreError('invalid-params', 'Validation error', parsedIn.issues);
      }
      const Ctor = services[desc.service] as AnyCtor;
      const deps = depKeys(Ctor).map((name) => inject[name](c));
      const instance = new Ctor(...deps);
      const handler = instance[desc.method];
      if (typeof handler !== 'function') {
        throw new CoreError('not-found', `Method not found: ${method}`);
      }
      // .call(instance): обработчик — async function* (не стрелка), this = инстанс (this.ctx и DI).
      return handler.call(instance, parsedIn.value, signal) as AsyncIterable<unknown>;
    })) as AsyncIterable<unknown>;
    for await (const event of iterable) {
      if (signal.aborted) throw new DOMException('The stream was aborted', 'AbortError');
      const parsed = await eventSchema['~standard'].validate(event);
      if ('issues' in parsed) {
        throw new CoreError('invalid-output', 'Event validation error', parsed.issues);
      }
      yield parsed.value;
    }
  }

  return {
    instantiate,
    call: (method, params, opts) => dispatch({ method, params }, opts?.ctx ?? {}),
    notify: async (method, params, opts) => {
      await dispatch({ method, params }, opts?.ctx ?? {});
    },
    stream,
    endpoints: () => registry,
    run: <T>(ctx: unknown, terminal: (ctx: unknown) => Promise<T>) =>
      runChain(ctx, composerMiddlewares, terminal) as Promise<T>,
    schemas: options?.schemas,
  };
}