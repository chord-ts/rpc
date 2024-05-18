import 'reflect-metadata';

import type {
  ComposerConfig,
  MethodDescription,
  PropertyDescription,
  Target,
  Schema,
  MethodMetadata,
  PropKey,
  Middleware,
  MethodConfig,
  Composed,
} from './types';

import {
  ErrorCode,
  buildResponse,
  buildError,
  type Request,
  type SomeResponse,
  type BatchResponse
} from '../specs';

/* The `Composer` class is a TypeScript class that provides a framework for composing and executing
methods with middleware support. */
export class Composer<T extends { [s: string]: unknown }> {
  private config?: ComposerConfig;
  private models: T;
  private middlewares: Middleware[];

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
    this.config = config;
    // List is unwrapped client and Records<string, Target> are wrapped
    this.models = models;
    for (const [name, Model] of Object.entries(models)) {
      // @ts-expect-error: we inject Models manually to Composer
      this[name] = Model;
    }
    this.middlewares = [];
  }

  // We need mapping <ClassName>/<MethodName> to avoid overlapping of methods with the same name
  static methods = new Map<string, MethodDescription>();

  // We need to use name of class as key to optimize dependency search in case of large amount of DI
  static props = new Map<string, PropertyDescription[]>();


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

  // TODO return extended T
  static init<T extends { [s: string]: unknown }>(models: T, config?: ComposerConfig): Composed<T> {
    return new Composer(models, config) as unknown as Composed<T>;
  }

/**
 * The function `addMethod` adds a method description to a map called `Composer.methods`.
 * @param {MethodDescription} desc - The parameter `desc` is of type `MethodDescription`.
 */
  static addMethod(desc: MethodDescription) {
    const key = `${desc.target.constructor.name}.${desc.key.toString()}`;
    Composer.methods.set(key, { ...desc, key });
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
 * The function `findRequestField` checks if an event object has a `body` and `method` property, and if
 * not, it checks if it has a `request` property and returns it.
 * @param {unknown} event - The `event` parameter is of type `unknown`, which means it can be any type
 * of value. It is used to represent an event object that is passed to the `findRequestField` function.
 * The function checks if the `event` object has a `body` property and a `method`
 * 
 * @returns The function `findRequestField` returns the `event` object if it has a `body` property and
 * a `method` property. If the `event` object does not have these properties, it checks if the `event`
 * object has a property named `request`. If it does, it returns the `request` property of the `event`
 * object.
 */
  static findRequestField(event: unknown) {
    // @ts-expect-error: we don't know what is event object, it should be parsed by middleware
    if (event?.body && event.method) {
      return event;
    }

    const fields = Object.getOwnPropertyNames(event);
    if (fields.includes('request')) return (event as { request: Request })['request'];
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
 * It is a function that takes three arguments: `req`, `res`, and `next`. The `req` argument represents
 * the request object, the `res` argument represents the response object, and the `next` argument is a 
 * callback that should be called to continue the execution of middlewares and procedures.
 * @example
 * ```typescript
 * import { sveltekitMiddleware } from '@chord-ts/rpc/middlewares';
 * // ...
 * composer.use(sveltekitMiddleware())
 * ```
 * 
 */
  public use(middleware: Middleware) {
    this.middlewares.push(middleware);
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
  public async exec(event: unknown): Promise<SomeResponse | BatchResponse> {
    const { ctx, res } = await this.runMiddlewares(
      this.middlewares,
      event as Record<string, unknown>
    );
    if (res) return res as SomeResponse;

    let body = ctx?.body;

    if (!body) {
      console.warn('\x1b[33mNo middleware specified "body" field in context. Trying to find it');
      const request = Composer.findRequestField(event);

      if (!request) {
        return buildError({
          code: ErrorCode.ParseError,
          message: 'Body object was not found in provided event',
          data: []
        });
      }
      // @ts-expect-error: we found Request object
      body = await request.json();
    }

    // If body is not batch request, exec single procedure
    if (!Array.isArray(body)) {
      return this.execProcedure(body as Request, ctx);
    }

    const batch: BatchResponse = [];
    for (const proc of body) {
      batch.push(this.execProcedure(proc, ctx));
    }
    return Promise.all(batch);
  }

  private async runMiddlewares(
    middlewares: Middleware[],
    event: Record<string, unknown>
  ): Promise<{ ctx: Record<string, unknown>; res: unknown }> {
    const ctx = (event?.ctx ?? {}) as Record<string, unknown>;

    let lastMiddlewareResult;
    let middlewareIndex = -1;

    async function next() {
      middlewareIndex++;
      if (middlewareIndex >= middlewares.length) return;

      const middleware = middlewares[middlewareIndex];
      lastMiddlewareResult = await middleware(event, ctx, next);
    }
    await next();

    if (middlewareIndex <= middlewares.length - 1) {
      return { ctx, res: lastMiddlewareResult };
    }

    return { ctx, res: undefined };
  }

  private async execProcedure(proc: Request, ctx: Record<string, unknown>) {
    if (!proc?.method || !proc?.params) {
      return buildError({
        code: ErrorCode.InvalidRequest,
        message: 'Wrong invocation. Method and Args must be defined',
        data: []
      });
    }

    let { method, params } = proc;
    const methodDesc = Composer.methods.get(method);
    if (!method || !methodDesc) {
      const msg = `Error: Cannot find method: "${method}"\nHave you marked it with @rpc() decorator?`;
      console.error('\x1b[31m' + msg);
      return buildError({
        code: ErrorCode.MethodNotFound,
        message: msg,
        data: []
      });
    }
    // TODO handle Invalid Params error
    const { target, descriptor, use, argNames } = methodDesc;

    try {
      let res;
      ({ ctx, res } = await this.runMiddlewares(use, {
        ctx,
        raw: proc,
        methodDesc,
        call: { method, params }
      }));
      if (res) return res as SomeResponse;

      // Inject ctx dependency
      const ctxProp = Composer.props.get(target.constructor.name)?.find((d) => d.key === 'ctx');
      if (ctxProp) {
        Reflect.defineProperty(target, ctxProp.key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: ctx,
          
        });
      }

      // Handle if params is not array, but object
      if (!Array.isArray(params)) {
        params = argNames.map(key => params[key])
      }

      const result = await descriptor.value.apply(target, params);
      return buildResponse({
        request: proc,
        result
      });
    } catch (e) {      
      (this.config?.onError ?? console.error)(e, proc);

      return buildError({
        code: ErrorCode.InternalError,
        message: (e as { message?: string })?.message ?? '',
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
    Composer.addMethod({
      key,
      descriptor,
      metadata,
      target: instance,
      use: [],
      validators: {},
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
    // console.log(key, key, descriptor)
    // console.log('Metadata', Reflect.getMetadataKeys(target))
    // console.log("design:paramtypes", Reflect.getMetadata("design:paramtypes", target, key).map(v => v.name));
    // console.log("design:type", Reflect.getMetadata("design:type", target, key));
    // console.log('add', )
    // TODO return type doesn`t work
    // console.log(target.constructor.name)
    // console.log("design:returntype", Reflect.getMetadata('design:returntype', target, key)?.name);

    const metadata = getMetadata(target, key);
    const use = config?.use ?? [];
    const argNames = getParamNames(descriptor.value);

    if (config?.in && !Array.isArray(config?.in)) {
      config.in = [config.in]
    }
    
    const validators = { in: config?.in, out: config?.out };
    Composer.addMethod({ key, descriptor, metadata, target, use, validators, argNames });
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
    // Reflect.defineProperty(target, key, {
    //   configurable: false,
    //   enumerable: false,
    //   get() {
    //     return 'hello world';
    //   }
    // });
  };
}
