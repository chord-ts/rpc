import {defaultCache, defaultOnError, defaultTransport} from './defaults'

import type {
  IRPC,
  Transport,
  ErrorCallback,
  CacheStorage,
} from './types';

import type { FailedResponse, Response, BatchRequest, BatchResponse } from '../specs';
import { buildRequest } from '../specs';

export type { Returned } from './types'
/**
 * @example
 * ```typescript
 * // +server.ts
 * export type Client = typeof composer.clientType
 *
 * // +page.svelte
 * import { client } from '@chord-ts/rpc/client';
 * import type { Client } from './+server';
 *
 * const rpc = client<Client>({ endpoint: '/<path to endpoint>' });
 * ```
 */

export function client<T>(init: IRPC.Init): IRPC.Builder<T> {
  const rpc = new RPC(init);
  const builder = new Builder(rpc);
  return builder as unknown as  IRPC.Builder<T>;
}

/**
 * Generic that simplifies extraction of returned type of function
 * @param {T} functionType - The `functionType` parameter is of type `T`, which represents a function
 * @example
 * ```typescript
 * const fn = async (a: number, b: string) => a + b;
 * type Sum = Returned<typeof fn>; // string
 * ```
 */

export class RPC<T> implements IRPC.Client<T> {
  private transport: Transport;
  private errorCallback: ErrorCallback;
  private cacheStorage: CacheStorage;

  private endpoint: string;
  private internal: Set<string | symbol>

  private options: IRPC.Options

  constructor({ endpoint, config, options }: IRPC.Init) {
    if (!endpoint) {
      throw Error('No RPC endpoint was provided');
    }
    this.endpoint = endpoint;
    
    const proto = Reflect.getPrototypeOf(this)!;
    this.internal = new Set([...Reflect.ownKeys(proto), ...Reflect.ownKeys(this)]);

    this.transport = config?.transport ?? defaultTransport;
    this.errorCallback = config?.onError ?? defaultOnError;
    this.cacheStorage = config?.cache ?? defaultCache;

    this.options = options ?? {};
  }

  public isInternal(prop: string) {
    return this.internal.has(prop);
  }

  /**
   * The function "call" is a TypeScript function that takes a method name and returns an asynchronous
   * function that accepts an array of parameters, builds a request, sends it using a transport
   * function, handles any errors, and returns the result.
   * @param {string} method - The `method` parameter is a string that represents the name of the method
   * to be called.
   * @returns an asynchronous function that takes an array of unknown parameters and returns a Promise.
   */
  async call<P, R>({method, params}: IRPC.Call<P>): Promise<R | void> {
    const body = buildRequest({ method, params });
    // TODO handle network error
    const res = await this.transport({ route: this.endpoint, body }, this.options ?? {});
    if ((res as FailedResponse).error) {
      await this.errorCallback((res as FailedResponse).error, body);
      return 
    }
    return (res as Response<R>).result;
  }

  /**
   * The function `batch` is an async function that takes in multiple calls and sends them as a batch
   * request, returning the results.
   * @param {BatchRequest} calls - The `calls` parameter is an array of batch requests. Each batch
   * request is an object that contains the necessary information to make a request to the server.
   * @returns The function `batch` returns an array of results. Each result corresponds to a call made
   * in the `calls` parameter. If a call fails and returns a `FailedResponse` object, the
   * `errorCallback` function is called with the error and the corresponding call. Otherwise, the
   * result is extracted from the `Response` object and returned in the array.
   */
  public async batch(...calls: BatchRequest) {
    const res = (await this.transport({ route: this.endpoint, body: calls })) as BatchResponse;
    return res.map((r, i) => {
      if ((r as FailedResponse)?.error) {
        this.errorCallback((r as FailedResponse).error, calls[i]);
      }
      return (r as Response).result;
    });
  }

  /**
   * The `cache` function is a higher-order function that returns a function that caches the results of
   * a given method call.
   * @param {CacheConfig} config - The `config` parameter is an object that contains configuration
   * options for the cache. It may have the following properties:
   * @returns The function `cache` returns a higher-order function.
   */
  public cache(config: CacheConfig) {
    const { get, set } = this.cacheStorage(config);
    return function (method: string) {
      return async function (...params: unknown[]) {
        const cached = get({ method, params });
        if (config?.mode !== 'update' && cached) return cached;
        const res = this.call(method)(params).then((res) => {
          set({ method, params }, res);
          return res;
        });
        return cached ?? res;
      };
    };
  }

  private chainUpdate(override: IRPC.Overridable) {
    const newRPC = new RPC<T>({ 
      endpoint: this.endpoint, 
      config: {...this.currentConfig, ...override.config},
      options: { ...this.options, ...override.options },  
    });
    return new Builder(newRPC);
  }

  private get currentConfig() {
    return {
      transport: this.transport,
      onError: this.errorCallback,
      cache: this.cacheStorage,
    };
  }

  public config(config: ClientConfig) {
    return this.chainUpdate({config});
  }
  
  public abort(signal: AbortController['signal']) {
    return this.chainUpdate({options: {signal}});
  }

  public opt(options: IRPC.Options) {
    return this.chainUpdate({options});
  }

  public pipe() {
    throw Error('Not implemented');
  }
}

export class Builder<T> extends Function {
  path: string[];
  rpc: RPC<T>;
  private internal: Set<string | symbol>


  constructor(rpc: RPC<T>, path: string[] = []) {
    super();

    const proto = Reflect.getPrototypeOf(this)!;
    this.internal = new Set([...Reflect.ownKeys(proto), ...Reflect.ownKeys(this)]);

    this.path = path;
    this.rpc = rpc;
    return new Proxy(this, this) as Builder<T>;
  }

  private get readyMethod() {
    return this.path.join('.');
  }

  public isInternal(prop: string) {
    return this.internal.has(prop);
  }

  // Proxy part for request generation
  apply<P, R>(target: Builder<T>, thisArg: any, argArray?: P): Promise<R> {
    return this.rpc.call<P, R>({method: this.readyMethod, params: argArray});
  }

  get(target: Builder<T>, prop: string) {
    if (this.isInternal(prop) && !this.path.length) {
      // Handle Builder methods
      return this[prop];
    } else if (this.rpc.isInternal(prop) && !this.path.length) {
      // Handle RPC methods
      return this.rpc[prop];
    }

    // We need to create new instance each time to prevent stacking of prop names without call
    return new Builder(this.rpc, this.path.concat(prop));
  }

  construct<T>(target: Builder<T>, args: any[]): BatchRequest {
    return buildRequest({ method: this.readyMethod, params: args });
  }
}


// https://bobbyhadz.com/blog/javascript-check-if-value-is-promise
// function isPromise(p: unknown) {
//   if (
//     p !== null &&
//     typeof p === 'object' &&
//     // @ts-expect-error: we check if p is Promise
//     typeof p?.then === 'function' &&
//     // @ts-expect-error: we check if p is Promise
//     typeof p?.catch === 'function'
//   ) {
//     return true;
//   }
//   return false;
// }

// function initClient({ schema, config }: { schema: Schema; config?: ClientConfig }) {
//   const transport = config?.transport ?? defaultTransport;
//   const errorCallback = config?.onError ?? defaultErrorCallback;
//   const cacheStorage = config?.cache ?? defaultCache;

//   /**
//    * The function "call" is a TypeScript function that takes a method name and returns an asynchronous
//    * function that accepts an array of parameters, builds a request, sends it using a transport
//    * function, handles any errors, and returns the result.
//    * @param {string} method - The `method` parameter is a string that represents the name of the method
//    * to be called.
//    * @returns an asynchronous function that takes an array of unknown parameters and returns a Promise.
//    */
//   function call(method: string, opt?: unknown[]) {
//     return async (params: unknown[]) => {
//       const body = buildRequest({ method, params });
//       const res = await transport({ route: schema.route, body }, ...(opt ?? []));
//       if ((res as FailedResponse).error) {
//         return await errorCallback((res as FailedResponse).error, body);
//       }
//       return (res as Response).result;
//     };
//   }

//   /**
//    * The function `batch` is an async function that takes in multiple calls and sends them as a batch
//    * request, returning the results.
//    * @param {BatchRequest} calls - The `calls` parameter is an array of batch requests. Each batch
//    * request is an object that contains the necessary information to make a request to the server.
//    * @returns The function `batch` returns an array of results. Each result corresponds to a call made
//    * in the `calls` parameter. If a call fails and returns a `FailedResponse` object, the
//    * `errorCallback` function is called with the error and the corresponding call. Otherwise, the
//    * result is extracted from the `Response` object and returned in the array.
//    */
//   async function batch(...calls: BatchRequest) {
//     if (calls.filter((c) => isPromise(c)).length) {
//       throw EvalError(
//         'The batched method is required for "batch" call. \n' +
//           'Try to use rpc.<Model>.<method>.batch(...) instead.'
//       );
//     }
//     const res = (await transport({ route: schema.route, body: calls })) as BatchResponse;
//     return res.map((r, i) => {
//       if ((r as FailedResponse)?.error) {
//         errorCallback((r as FailedResponse).error, calls[i]);
//       }
//       return (r as Response).result;
//     });
//   }

//   /**
//    * The `cache` function is a higher-order function that returns a function that caches the results of
//    * a given method call.
//    * @param {CacheConfig} config - The `config` parameter is an object that contains configuration
//    * options for the cache. It may have the following properties:
//    * @returns The function `cache` returns a higher-order function.
//    */
//   function cache(config: CacheConfig) {
//     const { get, set } = cacheStorage(config);
//     return function (method: string) {
//       return async function (...params: unknown[]) {
//         const cached = get({ method, params });

//         if (!(config?.mode === 'update') && cached) return cached;

//         const res = call(method)(params).then((res) => {
//           set({ method, params }, res);
//           return res;
//         });
//         return cached ?? res;
//       };
//     };
//   }

//   return { call, batch, cache };
// }

/**
 * The `dynamicClient` function is a _TypeScript_ function that creates a dynamic client for making API
 * calls based on a provided endpoint and configuration.
 *
 * @typeParam T - The type describes `Services`. We have to import it from the server-side code. It's valid import, because it's not a value
 * @param {ClientParams}[params] - The `params` parameter is an optional object that can contain two properties.
 * `endpoint` - is a path for endpoint that handles JSON-RPC calls with POST method
 * @example
 * ```typescript
 * // +server.ts
 * export type Client = typeof composer.clientType
 *
 * // +page.svelte
 * // client and dynamicClient are the same
 * import { dynamicClient } from '@chord-ts/rpc/client';
 * import type { Client } from './+server';
 *
 * const rpc = client<Client>({ endpoint: '/<path to endpoint>' });
 * ```
 * @returns The function `dynamicClient` returns an instance of `Client<T>`.
 */
// export function clientV0<T>(init?: ClientInit): Client<T> {
//   let endpoint;
//   try {
//     endpoint = init?.endpoint ?? window?.location?.href;
//   } catch {
//     endpoint = '/';
//     console.error(`No endpoint provided and window.location is undefined. It set '/' as default`);
//   }
//   const schema = { route: endpoint } as Schema;

//   type Path = { path: string[]; modifiers: string[] } & object;

//   const { call, batch, cache } = initClient({ schema, config: init?.config });

//   const modifiers = {
//     apply: function (target: Path, _: unknown, params: unknown[]) {
//       const method = target.path.join('.');
//       const [modifier] = target.modifiers;

//       if (modifier === 'batch') {
//         return buildRequest({ method, params });
//       } else if (modifier === 'cache') {
//         return cache(params[0] as CacheConfig)(method);
//       } else if (modifier === 'opt') {
//         const options = params;
//         return (...params: unknown[]) => call(method, options)(params);
//       } else {
//         return call(method)(params);
//       }
//     },

//     get: function (target: Path, prop: string): unknown {
//       target.modifiers = target.modifiers.concat(prop);
//       return new Proxy(
//         Object.assign(function () {}, target),
//         modifiers
//       );
//     },

//     construct(target, args) {
//       console.log('construct', target.path, args);
//       // return buildRequest({method: })
//       return {};
//     }
//   };

//   const method = {
//     get: function (target: Path, prop: string): unknown {
//       target.path = [target.path[0], prop];
//       return new Proxy(
//         Object.assign(function () {}, { path: [...target.path], modifiers: [] }),
//         modifiers
//       );
//     }
//   };
//   const service = {
//     get: function (target: Path, prop: string): unknown {
//       if (prop === 'batch') return batch;
//       return new Proxy({ path: [prop], modifiers: [] }, method);
//     }
//   };
//   return new Proxy({ path: [], modifiers: [] }, service) as unknown as Client<T>;
// }

