// Schema-agnostic core: schema-first registration (`fn`, `toRPC`, constructor DI)
// and the request execution pipeline (`exec` -> middleware chain -> validate/invoke/validate).

// --- Schema contract (vendor minimum of the Standard Schema v1 interface) ---
// zod 4 / valibot / arktype implement this shape; zod 3 needs a shim adapter.
// `readonly` omitted + `ReadonlyArray` used instead: SWC 1.5.5 fails to parse `readonly`
// inside a string-keyed nested method signature.
type ValidateResult<Output> = { value: Output } | { issues: ReadonlyArray<unknown> };

export interface AnySchema<Output = unknown> {
  '~standard': {
    version: 1;
    vendor: string;
    validate(value: unknown): ValidateResult<Output> | Promise<ValidateResult<Output>>;
  };
}

export type InferOutput<S extends AnySchema> = S extends AnySchema<infer O> ? O : never;

// --- JSON-RPC 2.0 error codes ---
export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

// --- Typed result: no exceptions escape the pipeline ---
export type ErrorObject = { code: number; message: string; data?: unknown; status?: number };

export type Result<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: ErrorObject };

// --- Middleware contract: onion `(ctx, next) => Result` ---
export type Middleware<Ctx = unknown> = (
  ctx: Ctx,
  next: (ctx: Ctx) => Promise<Result>
) => Promise<Result>;

type MaybeArray<T> = T | T[];

// --- schema-first contract + `fn` ---
export type Contract = {
  in: AnySchema<any>;
  out?: AnySchema<any>;
  use?: MaybeArray<Middleware<any>>;
};

type Out<C extends Contract> = C['out'] extends AnySchema<infer O> ? O : unknown;

export type Fn<C extends Contract> = C & {
  fn: (input: InferOutput<C['in']>) => Promise<Out<C>>;
};

/**
 * Declares a procedure from a schema. `$method.fn` is the phantom handler type:
 * the argument is inferred from `in`, the return from `out` (unknown when omitted).
 */
export function fn<C extends Contract>(c: C): Fn<C> {
  return c as unknown as Fn<C>;
}

// --- DI + Client types ---
type AnyCtor = new (...args: any[]) => any;

export type ServiceMap = Record<string, AnyCtor>;

// DI deps are the public data fields of the instance (constructor parameter properties
// declared `public readonly`/`readonly`); arrow-field methods are filtered out.
type DepKeyOf<C extends AnyCtor> = {
  [K in keyof InstanceType<C>]: InstanceType<C>[K] extends (...args: any[]) => any ? never : K;
}[keyof InstanceType<C>] & string;

type DepKeys<S extends ServiceMap> = { [K in keyof S]: DepKeyOf<S[K]> }[keyof S];

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

type DepType<S extends ServiceMap, K> = UnionToIntersection<
  { [Svc in keyof S]: InstanceType<S[Svc]> extends infer I ? (K extends keyof I ? I[K] : never) : never }[keyof S]
>;

/** DI factories keyed by dependency name; the return type must match the injected dependency. */
export type Injector<S extends ServiceMap, Ctx = any> = {
  [K in DepKeys<S>]: (ctx: Ctx) => DepType<S, K>;
};

export type Instantiated<S extends ServiceMap> = { [K in keyof S]: InstanceType<S[K]> };

type MethodKeys<T> = { [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never }[keyof T];
type RemoteMethod<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
type RemoteService<T> = { [K in MethodKeys<T>]: RemoteMethod<T[K]> };
/** Remote (transport) client type: public arrow fields only, returns wrapped in Promise. */
export type Client<S extends ServiceMap> = { [K in keyof S]: RemoteService<InstanceType<S[K]>> };

// Dependency keys match constructor parameter names (same trick as parsing method arg names).
// The constructor must be the first class member: `indexOf('(')` finds its parameter list.
function paramNames(ctor: AnyCtor): string[] {
  const src: string = ctor.toString();
  const head = src.slice(src.indexOf('(') + 1, src.indexOf(')'));
  const args = head.match(/([^\s,]+)/g);
  return args ?? [];
}

// --- JSON-RPC wire shapes ---
export type RPCId = string | number | null;

export interface RPCRequest {
  method: string;
  params?: unknown;
  id?: RPCId;
}

export interface RPCResponse {
  jsonrpc: '2.0';
  id: RPCId;
  result?: unknown;
  error?: ErrorObject;
}

export type RPCBody = RPCRequest | RPCRequest[];

type Call = { id: RPCId; method: string; params: unknown };
type MethodDesc = { service: string; method: string; contract: Contract | null; use: Middleware[] };

export interface Composer<S extends ServiceMap> {
  instantiate(ctx: unknown): Instantiated<S>;
  exec(body: RPCBody, opts?: { ctx?: unknown }): Promise<RPCResponse | RPCResponse[] | undefined>;
}

export interface ToRPCOptions<S extends ServiceMap> {
  inject: Injector<S>;
  use?: MaybeArray<Middleware>;
}

export function toRPC<S extends ServiceMap>(services: S, options: ToRPCOptions<S>): Composer<S> {
  const inject = options.inject as unknown as Record<string, (ctx: any) => any>;
  const composerMiddlewares: Middleware[] = Array.isArray(options.use)
    ? options.use
    : options.use
      ? [options.use]
      : [];

  // Endpoints come from `static $method = fn({...})` (schema-first) and from public
  // prototype methods without `$method` (simple, no validation).
  const routes = new Map<string, MethodDesc>();
  for (const [service, Ctor] of Object.entries(services)) {
    for (const [key, contract] of Object.entries(Ctor)) {
      if (!key.startsWith('$') || typeof contract !== 'object' || contract === null || !('in' in contract)) {
        continue;
      }
      const method = key.slice(1);
      routes.set(`${service}.${method}`, {
        service,
        method,
        contract: contract as Contract,
        use: Array.isArray(contract.use) ? contract.use : contract.use ? [contract.use] : [],
      });
    }

    // No `$method` → simple endpoint: types come from the method, validation skipped.
    for (const method of Object.getOwnPropertyNames(Ctor.prototype)) {
      if (method === 'constructor' || routes.has(`${service}.${method}`)) continue;
      routes.set(`${service}.${method}`, { service, method, contract: null, use: [] });
    }
  }

  function instantiate(ctx: unknown): Instantiated<S> {
    const built: Record<string, unknown> = {};
    for (const key of Object.keys(services) as (keyof S)[]) {
      const Ctor = services[key] as AnyCtor;
      const deps = paramNames(Ctor).map((name) => inject[name](ctx));
      built[key as string] = new Ctor(...deps);
    }
    return built as Instantiated<S>;
  }

  function normalize(body: RPCBody): Call[] {
    return Array.isArray(body)
      ? body.map((req) => ({ id: req.id ?? null, method: req.method, params: req.params }))
      : [{ id: body.id ?? null, method: body.method, params: body.params }];
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

  function toWire(result: Result, id: RPCId): RPCResponse {
    if (result.ok) return { jsonrpc: '2.0', id, result: result.value };
    return { jsonrpc: '2.0', id, error: result.error };
  }

  async function exec(
    body: RPCBody,
    opts?: { ctx?: unknown }
  ): Promise<RPCResponse | RPCResponse[] | undefined> {
    const ctx = opts?.ctx ?? {};
    const out: RPCResponse[] = [];
    for (const call of normalize(body)) {
      const result = await dispatch(call, ctx);
      if (call.id != null) out.push(toWire(result, call.id));
    }
    return Array.isArray(body) ? out : out[0];
  }

  return { instantiate, exec };
}