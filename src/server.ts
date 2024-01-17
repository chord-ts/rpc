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
  Composed
} from './types';

import {
  ErrorCode,
  buildResponse,
  buildError,
  type Request,
  type SomeResponse,
  type BatchResponse
} from './specs';

export class Composer<T extends { [s: string]: unknown }> {
  private config?: ComposerConfig;
  private models: T;
  private middlewares: Middleware[];

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

  static init<T extends { [s: string]: unknown }>(models: T, config?: ComposerConfig): Composed<T> {
    return new Composer(models, config) as unknown as Composed<T>;
  }

  static addMethod(desc: MethodDescription) {
    const key = `${desc.target.constructor.name}.${desc.key.toString()}`;
    Composer.methods.set(key, { ...desc, key });
  }

  static addProp({ key, target }: { key: PropKey; target: object }) {
    const targetName = `${target.constructor.name}`;
    const oldProps = Composer.props.get(targetName) ?? [];
    Composer.props.set(targetName, oldProps.concat({ key, target }));
  }

  static findRequestField(event: unknown) {
    // @ts-expect-error: we don't know what is event object, it should be parsed by middleware
    if (event?.body && event.method) {
      return event;
    }

    const fields = Object.getOwnPropertyNames(event);
    if (fields.includes('request')) return (event as { request: Request })['request'];
  }

  public get clientType(): T {
    // We don't need value, just a type
    return {} as unknown as T;
  }

  public use(middleware: Middleware) {
    this.middlewares.push(middleware);
  }

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
    if (!Array.isArray(body)) {
      return this.execProcedure(body as Request, ctx);
    }

    const batch: BatchResponse = [];
    for (const proc of body) {
      // We don't want to use Promise All to save the order of execution, isn't it?
      batch.push(await this.execProcedure(proc, ctx));
    }
    return batch;
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

    const { method, params } = proc;
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
    const { target, descriptor, use } = methodDesc;

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
