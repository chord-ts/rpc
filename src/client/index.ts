// @ts-nocheck
import { defaultCache, defaultOnError, defaultTransport } from './defaults';

import type { IRPC, Transport, ErrorCallback, Cache, Format } from './types';

import type { FailedResponse, Response, BatchRequest, BatchResponse } from '../specs';
import { buildRequest } from '../specs';

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
  return builder as unknown as IRPC.Builder<T>;
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

export class RPC<T extends IRPC.Schema> implements IRPC.Client<T> {
  #transport: Transport;
  #format: Format;
  errorCallback: ErrorCallback;
  cacheStorage: Cache.Storage;
  endpoint: string;
  internal: Set<string | symbol>;

  options: IRPC.Options;

  constructor({ endpoint, config, options }: IRPC.Init) {
    if (!endpoint) {
      throw Error('No RPC endpoint was provided');
    }
    this.endpoint = endpoint;

    const proto = Reflect.getPrototypeOf(this)!;
    this.internal = new Set([...Reflect.ownKeys(proto), ...Reflect.ownKeys(this)]);
    this.#transport = config?.transport ?? defaultTransport;
    this.#format = config?.format ?? {
      parse: (r) => r.json(),
      stringify: (r) => JSON.stringify(r)
    }
    this.errorCallback = config?.onError ?? defaultOnError;
    this.cacheStorage = config?.cache ?? defaultCache;

    this.options = options ?? {};
  }

  // FIXME: in prod build fields disappears in internal set
  get transport() {
    return this.#transport;
  }
  get format() {
    return this.#format;
  }

  /**
   * The function checks if a property is internal to the object.
   * @param {string} prop - The property name to check.
   * @returns A boolean value indicating whether the property is internal to the object.
   */
  // @ts-expect-error
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
  async call<P, R>({ method, params }: IRPC.Call<P>): Promise<R | void> {
    const body = buildRequest({ method, params });
    // TODO handle network error
    const res = await this.transport({ route: this.endpoint, body, format: this.format }, this.options ?? {});
    if ((res as FailedResponse).error) {
      await this.errorCallback((res as FailedResponse).error, body);
      return;
    }
    return (res as Response<R>).result;
  }

  private chainUpdate(override: IRPC.Overridable) {
    const newRPC = new RPC<T>({
      endpoint: this.endpoint,
      config: { ...this.currentConfig, ...override.config },
      options: { ...this.options, ...override.options }
    });
    return new Builder(newRPC);
  }

  private get currentConfig() {
    return {
      transport: this.transport,
      onError: this.errorCallback,
      cache: this.cacheStorage
    };
  }

  public config(config: ClientConfig) {
    return this.chainUpdate({ config });
  }

  public abort(signal: AbortController['signal']) {
    return this.chainUpdate({ options: { signal } });
  }

  public opt(options: IRPC.Options) {
    return this.chainUpdate({ options });
  }

  public pipe() {
    throw Error('Not implemented');
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
}

export class Builder<T> extends Function {
  path: string[];
  rpc: RPC<T>;
  internal: Set<string | symbol>;

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
  apply<P, R>(target: object, thisArg: unknown, argArray?: P): Promise<R> {
    return this.rpc.call({ method: this.readyMethod, params: argArray });
  }

  get(target: Builder<T>, prop: string) {
    if (this.isInternal(prop) && !this.path.length ) {
      // Handle Builder methods
      return this[prop];
    } else if (this.rpc.isInternal(prop) && !this.path.length ) {
      // Handle RPC methods
      return this.rpc[prop];
    }

    // We need to create new instance each time to prevent stacking of prop names without call
    return new Builder(this.rpc, this.path.concat(prop));
  }

  construct<T>(target: Builder<T>, args: unknown[]): BatchRequest {
    return buildRequest({ method: this.readyMethod, params: args });
  }
}
