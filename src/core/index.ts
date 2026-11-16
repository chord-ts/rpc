// Protocol-agnostic core (the gasket). Imports only the shared types layer — zero vendor
// deps, no knowledge of protocol/transport/format/generation. JSON-RPC envelope (exec),
// REST sugar and agent tools live in upper layers and build on call/notify/endpoints.

import {
  ErrorCode,
  type AnyCtor,
  type Call,
  type ComposeOptions,
  type Contract,
  type Core,
  type Endpoint,
  type Fn,
  type Instantiated,
  type MethodDesc,
  type Middleware,
  type Result,
  type ServiceMap,
} from '../types';

/**
 * Declares a procedure from a schema. `$method.fn` is the phantom handler type:
 * the argument is inferred from `in`, the return from `out` (unknown when omitted).
 */
export function fn<C extends Contract>(c: C): Fn<C> {
  return c as unknown as Fn<C>;
}

// Dependency keys match constructor parameter names (parsing ctor.toString()).
// Locate `constructor(` specifically — the first '(' may belong to a static fn() field
// when the class has no explicit constructor (then there are no deps → []).
// Known limit: minified bundles mangle parameter names — see DI-minification track.
export function paramNames(ctor: AnyCtor): string[] {
  const src: string = ctor.toString();
  const idx = src.indexOf('constructor(');
  if (idx === -1) return [];
  const start = idx + 'constructor('.length;
  const head = src.slice(start, src.indexOf(')', start));
  return head.match(/([^\s,]+)/g) ?? [];
}

// Endpoints come from `static $method = fn({...})` (schema-first) and from public
// prototype methods without `$method` (simple, no validation).
function buildRoutes<S extends ServiceMap>(services: S): Map<string, MethodDesc> {
  const routes = new Map<string, MethodDesc>();
  for (const [service, Ctor] of Object.entries(services)) {
    // Класс протокол-согласован: либо REST (get/post, contract.rest), либо RPC (fn/stream).
    // Смешивать стили в одном классе нельзя — разнесите по разным сервисам.
    let hasRest = false;
    let hasRpc = false;
    for (const [key, contract] of Object.entries(Ctor)) {
      if (!key.startsWith('$') || typeof contract !== 'object' || contract === null || !('in' in contract)) {
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

    // Регистрируем отдельно методы без описания
    for (const method of Object.getOwnPropertyNames((Ctor as AnyCtor).prototype)) {
      if (method === 'constructor' || routes.has(`${service}.${method}`)) continue;
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
      const deps = paramNames(Ctor as AnyCtor).map((name) => inject[name]?.(dummy));
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
  terminal: (ctx: unknown) => Promise<Result>
): Promise<Result> {
  const dispatch = (i: number) => (c: unknown): Promise<Result> =>
    i < middlewares.length ? middlewares[i](c, dispatch(i + 1)) : terminal(c);
  return dispatch(0)(ctx);
}

/** Registers services and returns the protocol-agnostic gasket.
 * options опциональны: для сервисов без зависимостей достаточно `compose({ Service })`. */
export function compose<S extends ServiceMap>(services: S, options?: ComposeOptions<S>): Core<S> {
  const inject = (options?.inject ?? {}) as unknown as Record<string, (ctx: any) => any>;
  const use = options?.use;
  const composerMiddlewares: Middleware[] = Array.isArray(use) ? use : use ? [use] : [];
  const validateOut = options?.validateOut ?? false;
  const routes = buildRoutes(services);
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
      const deps = paramNames(Ctor).map((name) => inject[name](ctx));
      built[key as string] = new Ctor(...deps);
    }
    return built as Instantiated<S>;
  }

  async function invoke(desc: MethodDesc, params: unknown, ctx: unknown): Promise<Result> {
    const Ctor = services[desc.service] as AnyCtor;
    const deps = paramNames(Ctor).map((name) => inject[name](ctx));
    const instance = new Ctor(...deps);
    const handler = instance[desc.method];

    if (typeof handler !== 'function') {
      return {
        ok: false,
        error: { code: ErrorCode.MethodNotFound, message: `Method not found: ${desc.service}.${desc.method}` },
      };
    }

    try {
      if (desc.contract) {
        const parsedIn = await desc.contract.in['~standard'].validate(params);
        if ('issues' in parsedIn) {
          return {
            ok: false,
            error: { code: ErrorCode.InvalidParams, message: 'Validation error', data: parsedIn.issues },
          };
        }

        const value = await handler(parsedIn.value);

        // out всегда задаёт тип возврата; рантайм-проверка — только по флагу validateOut.
        if (desc.contract.out && validateOut) {
          const parsedOut = await desc.contract.out['~standard'].validate(value);
          if ('issues' in parsedOut) {
            return {
              ok: false,
              error: { code: ErrorCode.InternalError, message: 'Response validation error', data: parsedOut.issues },
            };
          }
          return { ok: true, value: parsedOut.value };
        }

        return { ok: true, value };
      }

      // Simple endpoint (no schema): pass params straight to the handler.
      const value = await (handler.length <= 1
        ? handler(params)
        : Array.isArray(params)
          ? handler(...params)
          : handler(params));
      return { ok: true, value };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: { code: ErrorCode.InternalError, message, data: e } };
    }
  }

  async function dispatch(call: Call, ctx: unknown): Promise<Result> {
    const desc = routes.get(call.method);
    if (!desc) {
      return { ok: false, error: { code: ErrorCode.MethodNotFound, message: `Method not found: ${call.method}` } };
    }
    const terminal = (c: unknown) => invoke(desc, call.params, c);
    return runChain(ctx, [...composerMiddlewares, ...desc.use], terminal);
  }

  return {
    instantiate,
    call: (method, params, opts) => dispatch({ id: null, method, params }, opts?.ctx ?? {}),
    notify: async (method, params, opts) => {
      await dispatch({ id: null, method, params }, opts?.ctx ?? {});
    },
    endpoints: () => registry,
    schemas: options?.schemas,
  };
}