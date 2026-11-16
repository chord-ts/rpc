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

// Dependency keys match constructor parameter names (parsing fn.toString()).
// The constructor must be the first class member: `indexOf('(')` finds its parameter list.
export function paramNames(ctor: AnyCtor): string[] {
  const src: string = ctor.toString();
  const head = src.slice(src.indexOf('(') + 1, src.indexOf(')'));
  const args = head.match(/([^\s,]+)/g);
  return args ?? [];
}

// Endpoints come from `static $method = fn({...})` (schema-first) and from public
// prototype methods without `$method` (simple, no validation).
function buildRoutes<S extends ServiceMap>(services: S): Map<string, MethodDesc> {
  const routes = new Map<string, MethodDesc>();
  for (const [service, Ctor] of Object.entries(services)) {
    for (const [key, contract] of Object.entries(Ctor)) {
      if (!key.startsWith('$') || typeof contract !== 'object' || contract === null || !('in' in contract)) {
        continue;
      }
      // TODO нет проверки и warning на отсутствие метода для схемы
      const method = key.slice(1);
      routes.set(`${service}.${method}`, {
        service,
        method,
        contract: contract as Contract,
        use: Array.isArray(contract.use) ? contract.use : contract.use ? [contract.use] : [],
      });
    }


    // Регистрируем отдельно методы без описания
    for (const method of Object.getOwnPropertyNames((Ctor as AnyCtor).prototype)) {
      if (method === 'constructor' || routes.has(`${service}.${method}`)) continue;
      routes.set(`${service}.${method}`, { service, method, contract: null, use: [] });
    }
  }
  return routes;
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

/** Registers services and returns the protocol-agnostic gasket. */
export function compose<S extends ServiceMap>(services: S, options: ComposeOptions<S>): Core<S> {
  const inject = options.inject as unknown as Record<string, (ctx: any) => any>;
  const composerMiddlewares: Middleware[] = Array.isArray(options.use)
    ? options.use
    : options.use
      ? [options.use]
      : [];
  const routes = buildRoutes(services);
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

        if (desc.contract.out) {
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
    schemas: options.schemas,
  };
}