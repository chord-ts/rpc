import 'reflect-metadata';

import type {
  ComposerConfig,
  MethodDescription,
  PartialMethodDescription,
  PropertyDescription,
  Target,
  Schema,
  MethodMetadata,
  PropKey,
  Middleware,
  MethodConfig,
  Composed,
  Event,
  Context,
  ModifiedContext
} from './types';

import { ErrorCode, buildResponse, buildError } from '../specs';

import type * as JSONRPC from '../specs';
import { ZodAdapter } from '../validators';

/* The `Composer` class is a TypeScript class that provides a framework for composing and executing
methods with middleware support. */
export class Composer<T extends { [k: string]: object }> {
  private config: ComposerConfig;
  private models: T;
  private middlewares: Middleware<Event, Context, Context>[];
  private adapter: Middleware<Event, { body: unknown }, Context> | null = null;

  /**
   * The constructor initializes a Composer instance with models and an optional configuration.
   * Should not be used, because TypeScript will not know about passed Service objects
   * @param {T} models - The `models` parameter is of type `T`, which represents a generic type. It is
   * used to specify the models that will be injected into the Composer instance. The models are
   * expected to be an object where the keys are strings representing the model names, and the values
   * are the actual model classes.
   * @param {ComposerConfig} [config] - The `config` parameter is an optional argument of type
   * `ComposerConfig`. It is used to provide configuration options for the Composer constructor.
   */
  constructor(models: T, config?: ComposerConfig) {
    this.config = config ?? {};
    this.config.validator ??= ZodAdapter;
    // List is unwrapped client and Records<string, Target> are wrapped
    this.models = models;
    for (const [key, Model] of Object.entries(models)) {
      this[key] = Model;
    }

    this.middlewares = [];
  }

  // We need mapping <ClassName>/<MethodName> to avoid overlapping of methods with the same name
  static readonly methods = new Map<string, MethodDescription>();

  // We need to use name of class as key to optimize dependency search in case of large amount of DI
  static readonly props = new Map<string, PropertyDescription[]>();

  /**
   * The `init` function initializes a Composer instance with the given models and configuration, and
   * returns a composed object.
   * @param {T} models - The `models` parameter is a generic type `T` that extends an object with string
   * keys and unknown values. It represents a collection of models that will be used by the Composer.
   * @param {ComposerConfig} [config] - The `config` parameter is an optional object that represents the
   * configuration options for the Composer. It can contain various properties that customize the
   * behavior of the Composer.
   * @returns The `init` function returns an instance of the `Composer` class, casted as `Composed<T>`.
   *
   * @example
   * ```typescript
   * export class Say {
   *  @rpc() // Use decorator to register callable method
   *  hello(name: string): string {
   *    return `Hello, ${name}!`;
   *  }
   * }
   * export const composer = Composer.init({ Say: new Say() });
   * ```
   */
  static init<T extends { [k: string]: object }, Ctx extends Context>(
    models: T,
    config?: ComposerConfig
  ): Composed<T> {
    return new Composer(models, config) as unknown as Composed<T>;
  }

  /**
   * The function `addMethod` adds a method description to a map called `Composer.methods`.
   * @param {MethodDescription} desc - The parameter `desc` is of type `MethodDescription`.
   */
  static upsertMethod(desc: PartialMethodDescription) {
    const key = `${desc.target.constructor.name}.${desc.key.toString()}`;
    const old = Composer.methods.get(key) ?? { validators: { in: {}, out: {} } };

    const merged = { ...old, ...desc, key };
    merged.validators.in = { ...old.validators.in, ...desc.validators?.in };

    Composer.methods.set(key, merged as MethodDescription);
  }

  /**
   * The function `addProp` adds a property to a target object and stores it in a map.
   * @param {key: PropKey, target: object} [property]
   */
  static addProp({ key, target }: { key: PropKey; target: object }) {
    const targetName = `${target.constructor.name}`;
    const oldProps = Composer.props.get(targetName) ?? [];
    Composer.props.set(targetName, oldProps.concat({ key, target }));
  }

  /**
   * The function returns an empty object casted as a specific type. Use it only for generating a client type
   * @returns The code is returning an empty object (`{}`) that has been typecasted to `unknown` and then
   * to `T`.
   */
  public get clientType(): T {
    // We don't need value, just a type
    return {} as unknown as T;
  }

  /**
   * The "use" function adds a middleware function to the list of middlewares.
   * @param {Middleware} middleware - The `middleware` parameter is a function that acts as a middleware.
   * It is a function that takes three arguments: `event`, `ctx`, and `next`. The `event` argument represents
   * the raw Event object of server, the `ctx` argument represents computed context of parsed Event and results of middlewares, and the `next` argument is a
   * callback that should be called to continue the execution of middlewares and procedures.
   *
   * @example
   * ```typescript
   * import { sveltekitMiddleware } from '@chord-ts/rpc/middlewares';
   * // ...
   * composer.use(sveltekitMiddleware())
   * composer.use((event, ctx, next) => {
   *   console.log(event, ctx)
   *   ctx.computed = 'Your computed state'
   *   next()
   * })
   * ```
   *
   * You can intercept the execution of middlewares queue, just retuning Response or Error object
   * @example
   * ```ts
   * import {buildRequest} from '@chord-ts/rpc'
   * composer.use((event, ctx, next) => {
   *   console.log(event, ctx)
   *   ctx.computed = 'Your computed state'
   *   return buildRequest()
   * })
   * ```
   */
  public use<Ev, Ctx, Ext>(middleware: Middleware<Ev, Ctx, Ext>) {
    if (middleware.name === 'backendAdapter') {
      // @ts-ignore
      this.adapter = middleware;
      return;
    }
    // @ts-ignore
    this.middlewares.push(middleware);
  }

  public createScoped(ctx: unknown): T {
    return Object.fromEntries(
      Object.entries(this.models).map(([k, v]) => {
        return [
          k,
          new Proxy(v, {
            get:
              (target, prop) =>
              (...args) => {
                return target[prop].call({ ...target, ctx }, ...args);
              }
          })
        ];
      })
    ) as T;
  }

  public get stringified(): T {
    const allMethods: string[] = [];
    for (const [service, instance] of Object.entries(this.models)) {
      for (const method of Reflect.ownKeys(Reflect.getPrototypeOf(instance)!)) {
        if (method === 'constructor') continue;
        allMethods.push(`${service}.${method.toString()}`);
      }
    }

    function serviceGet(target, prop, receiver) {
      function check(target, prop) {
        if (prop === Symbol.isConcatSpreadable) {
          return true;
        }
        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }
        return null;
      }

      function methodGet(target, prop, receiver) {
        const res = check(target, prop);
        if (res !== null) return res;
        return target.find((method) => method.endsWith(prop));
      }

      const res = check(target, prop);
      if (res !== null) return res;
      return new Proxy(
        target.filter((v) => v.startsWith(prop)),
        { get: methodGet }
      );
    }

    return new Proxy(allMethods, { get: serviceGet });
  }

  /**
   * The function `getSchema` returns a schema object containing information about methods, route, and
   * models.
   * @param {string} [route] - The `route` parameter is a string that represents the route for which the
   * schema is being generated. It is an optional parameter, meaning it can be omitted. If it is not
   * provided, the code checks if the `config` property exists and if it has a `route` property. If both
   * @returns a Schema object.
   */
  public getSchema(route?: string): Schema {
    route = route ?? (this.config?.route as string);
    if (!route) {
      throw new EvalError('No route provided during Composer initialization or Schema generation');
    }
    const methods: Record<string, MethodMetadata> = {};
    const modelsSet: Set<string> = new Set();
    for (const [key, info] of Composer.methods.entries()) {
      modelsSet.add(info.target.constructor.name);
      const { argsType, returnType } = info.metadata;
      methods[key] = { argsType, returnType } as MethodMetadata;
    }
    const models = Array.from(modelsSet);
    return { methods, route, models };
  }

  private async initCtx(event): Promise<Context> {
    const ctx = { body: null };
    if (this.adapter) {
      await this.adapter(event, ctx, () => {});
      return ctx as unknown as Context;
    }

    console.warn(
      '\x1b[33mNo "adapter" middleware specified. Trying to parse request automatically\n'
    );

    if (event.jsonrpc && event.method) {
      ctx.body = event;
      return ctx as unknown as Context;
    }

    if (event?.body && event.method) {
      return event;
    }

    if (typeof event.json === 'function') {
      ctx.body = await event.json();
      return ctx as unknown as Context;
    }

    const fields = Object.getOwnPropertyNames(event);
    if (fields.includes('request')) {
      ctx.body = await (event as { request: Request })['request'].json();
    }
    return ctx as unknown as Context;
  }

  /**
   * The function `exec` processes an event by running middlewares, extracting the body from the event,
   * and executing procedures either individually or in batch.
   * @param {unknown} event - The `event` parameter is of type `unknown`, which means it can be any
   * type of value. It is then casted to `Record<string, unknown>`, which represents an object with
   * string keys and unknown values.
   * @returns The function `exec` returns a `Promise` that resolves to either a `SomeResponse` object
   * or a `BatchResponse` array.
   * @example
   * __SvelteKit example__
   * ```typescript
   * export async function POST(event) {
   *  return json(await composer.exec(event));
   * }
   * ```
   *  __Express example__
   *```typescript
   * const app = express()
   * app.use(express.json());
   *
   * app.post('/', async (req, res) => {
   *  res.send(await composer.exec(req));
   * })
   * ```
   */
  public async exec<T extends object>(
    event: T
  ): Promise<JSONRPC.SomeResponse<any> | JSONRPC.BatchResponse<any>> {
    const ctx = await this.initCtx(event);
    const { body } = ctx;
    // If body is not batch request, exec single procedure
    if (!Array.isArray(body)) {
      return this.execProcedure(event as Event, ctx, body as JSONRPC.Request<JSONRPC.Parameters>);
    }

    const batch: JSONRPC.BatchResponse<JSONRPC.Value> = [];
    for (const req of body) {
      // @ts-ignore
      batch.push(this.execProcedure(event, ctx, req));
    }
    return Promise.all(batch);
  }

  private async runMiddlewares(
    middlewares: Middleware<Event, Context, {}>[],
    event: Event,
    ctx?: ModifiedContext<typeof this.middlewares>
  ): Promise<{ ctx: Context; res: unknown; error: unknown }> {
    // @ts-ignore
    ctx ??= {};

    let lastMiddlewareResult;
    let middlewareIndex = -1;
    let error;

    async function next() {
      middlewareIndex++;
      if (middlewareIndex >= middlewares.length || error) return;

      const middleware = middlewares[middlewareIndex];
      // @ts-ignore
      lastMiddlewareResult = await middleware(event, ctx!, next).catch((e) => (error = e));
    }
    await next();

    if (middlewareIndex <= middlewares.length - 1) {
      // @ts-ignore
      return { ctx, res: lastMiddlewareResult, error };
    }

    // @ts-ignore
    return { ctx, res: undefined, error };
  }

  private async execProcedure(
    event: Event,
    ctx: Record<string, unknown>,
    req: JSONRPC.Request<JSONRPC.Parameters>
  ) {
    if (!req?.method) {
      return buildError({
        code: ErrorCode.InvalidRequest,
        message: 'Wrong invocation. Method and Args must be defined',
        data: []
      });
    }

    let { method, params } = req;

    // Convert methodname from Key name to Class name
    const [cls, func] = method.split('.');
    method = `${this.models[cls].constructor.name}.${func}`;

    const methodDesc = Composer.methods.get(method);
    if (!method || !methodDesc) {
      const msg = `Error: Cannot find method: "${method}"\nHave you marked it with @rpc() decorator?`;
      console.error(
        '\x1b[31m' + msg + `\nRegistered methods: ${JSON.stringify(Composer.methods.entries())}`
      );
      return buildError({
        code: ErrorCode.MethodNotFound,
        message: msg,
        data: []
      });
    }
    // TODO handle Invalid Params error
    const { target, descriptor, use, argNames, validators } = methodDesc;
    // @ts-expect-error Create new instance for each request to prevent memory leak
    const targetInstance = new target.constructor();

    try {
      let res, error;
      // @ts-ignore
      ({ ctx, res, error } = await this.runMiddlewares(this.middlewares.concat(use), event, {
        ...ctx,
        // @ts-ignore
        methodDesc
      }));

      if (error) {
        return buildError({
          code: ErrorCode.InvalidParams,
          message: error.message ?? error.body?.message ?? '',
          data: error.data
        });
      }

      if (res) return res as JSONRPC.SomeResponse<JSONRPC.Parameters>;

      // Inject ctx dependency
      const ctxProp = Composer.props.get(target.constructor.name)?.find((d) => d.key === 'ctx');

      if (ctxProp) {
        Reflect.defineProperty(targetInstance, ctxProp.key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: ctx
        });
      }

      // Handle if params is not array, but object
      if (!Array.isArray(params)) {
        params = argNames.map((key) => (params as JSONRPC.Obj)[key]);
      }

      // Validate all params

      if (this.config?.validator && validators.in) {
        let errors = [];
        for (const [i, param] of params.entries()) {
          const validator = validators.in[i];
          // this.config.validator.validate(validator, param);

          const { success, error } = this.config.validator.validate(validator, param);
          if (!error) continue;
          // @ts-ignore
          errors = errors.concat(error.issues);
        }

        if (errors.length) {
          return buildError({
            code: ErrorCode.InvalidParams,
            message: 'Validation error',
            data: errors
          });
        }
      }

      const result = await descriptor.value.apply(targetInstance, params as JSONRPC.Arr);
      return buildResponse({
        // @ts-ignore
        request: req,
        result
      });
    } catch (e) {
      if (e?.status?.toString()?.startsWith('3')) {
        console.log('throw');
        throw e;
      }

      (this.config?.onError ?? console.error)(e, req);
      return buildError({
        code: ErrorCode.InternalError,
        message: (e as { message?: string })?.message ?? e?.body?.message ?? '',
        data: [e]
      });
    }
  }
}

// https://stackoverflow.com/questions/1007981/how-to-get-function-parameter-names-values-dynamically
const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/gm;
const ARGUMENT_NAMES = /([^\s,]+)/g;
function getParamNames(func: CallableFunction): string[] {
  const fnStr = func.toString().replace(STRIP_COMMENTS, '');
  let result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES) as
    | string[]
    | null;
  if (result === null) result = [];
  return result;
}

function getMetadata(target: object, key: PropKey): MethodMetadata {
  return {
    argsType: Reflect.getMetadata('design:paramtypes', target, key)?.map(
      (a: { name: string }) => a?.name
    ),
    returnType: Reflect.getMetadata('design:returntype', target, key)?.name
  };
}

/**
 * The `toRPC` function takes an object instance and adds all its methods to a Composer object.
 * @param {T} instance - The `instance` parameter is the object that you want to convert to an RPC
 * (Remote Procedure Call) object. It should be an instance of a class or an object that has methods
 * that you want to expose as RPC methods.
 * @returns The `toRPC` function returns the `instance` object that was passed as an argument.
 * It should be used during Composer initialization
 * @example
 * ```ts
 * class MyService {
 *   doSomething() {
 *     return 'Hello World';
 *   }
 * }
 *
 * const service = new MyService();
 * const composer = Composer.init({
 *  MyService: toRPC(service)
 * })
 * ```
 */
export function toRPC<T extends object>(instance: T): T {
  const proto = Reflect.getPrototypeOf(instance)!;
  for (const key of Reflect.ownKeys(proto)) {
    if (key === 'constructor') continue;

    const descriptor = Reflect.getOwnPropertyDescriptor(proto, key)!;
    if (!(descriptor.value instanceof Function)) continue;

    const metadata = getMetadata(proto, key);
    Composer.upsertMethod({
      key,
      descriptor,
      metadata,
      target: instance,
      use: [],
      argNames: []
    });
  }
  return instance;
}

/**
 * The `rpc` function is a TypeScript decorator that adds metadata and configuration options to Composer singleton.
 *
 * :::caution
 * Decorator registers method using the class name of parent. That's why you have to specify the same name as key during Composer initialization
 * :::
 * @category General Use
 * @param {MethodConfig} [config] - The `config` parameter is an optional object that contains
 * configuration options for the `rpc` function. It has the following properties:
 * @returns The `rpc` function returns a new function that takes three arguments: `target`, `key`, and
 * `descriptor`.
 * @example
 * ```ts
 * export class Say {
 *  @rpc() // Use decorator to register callable method
 *  hello(name: string): string {
 *    return `Hello, ${name}!`;
 *  }
 * }
 * ```
 */
export function rpc(config?: MethodConfig) {
  return function (target: Target, key: PropKey, descriptor: PropertyDescriptor) {
    const metadata = getMetadata(target, key);
    const argNames = getParamNames(descriptor.value);
    let use = config?.use ?? [];

    if (!Array.isArray(use)) {
      use = [use];
    }

    if (config?.in && !Array.isArray(config?.in)) {
      config.in = [config.in];
    }

    // const validators = { in: config?.in, out: config?.out };
    Composer.upsertMethod({ key, descriptor, metadata, target, use, argNames });
  };
}

/**
 * The `depends` function is used for dependency injection in TypeScript, specifically for injecting
 * the `ctx` property.
 * @returns The function `depends()` returns another function.
 */
export function depends() {
  return function (target: object, key: PropKey) {
    // const injectable = Reflect.getMetadata("design:type", target, key) as ClassConstructor<object>;
    Composer.addProp({
      key,
      target
    });

    // If dependency is context, inject it during exec call
    if (key === 'ctx') return;

    throw TypeError(
      "Dependency injection is supported only for 'ctx' property right now.\n" +
        `Remove ${String(key)} property inside ${target.constructor.name}`
    );
  };
}

export function val(validator: unknown) {
  return (target: Object, key: string | symbol, parameterIndex: number) => {
    Composer.upsertMethod({ target, key, validators: { in: { [parameterIndex]: validator } } });
  };
}
