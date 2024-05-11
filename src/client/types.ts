import type { Request, Error, BatchRequest, SomeResponse, BatchResponse } from '../specs';

export type Transport = <T, K>(
  data: {
    route: string;
    body: T;
  },
  opt?: object
) => Promise<SomeResponse<K> | BatchResponse<K>>;

export type ErrorCallback = <T>(e: Error, req: Request<T>) => Promise<unknown> | unknown;

export namespace Cache {
  export interface Config {
    expiry?: number;
    mode?: 'update';
    onInvalidate?: Invalidate;
  }
  export type Storage = (config?: Config) => { get: Getter; set: Setter };
  export type Getter = (call: { method: string; params: unknown }) => unknown;
  export type Setter = (call: { method: string; params: unknown }, result: unknown) => void;
  export type Invalidate = (args: unknown) => void;
}

export namespace IRPC {
  export interface Call<T> {
    method: string;
    params: T[];
    options?: Options;
  }
  export interface Config {
    transport?: Transport;
    cache?: Cache.Config;
    onError?: ErrorCallback;
  }

  export interface Options {
    [k: string]: unknown;
    signal: AbortController['signal'];
  }

  export interface Init {
    endpoint: string;
    config?: Config;
  }

  export interface Overridable {
    config?: Config;
    options?: Options;
  }


  type Schema = { [model: string]: { [method: string]: (...args: any) => any } };

  type Models<T extends Schema> = {
    [Property in keyof T]: Methods<T[Property]>;
  };

  interface Construct<T extends unknown[]> {
    new (...args: T): Request<T>;
  }

  // Not necessary if methods in class are async
  type Promised<F extends (...args: any) => any> = (
    ...args: Parameters<F>
  ) => Promise<ReturnType<F>>;

  type Methods<T extends Schema[keyof Schema]> = {
    [Property in keyof T]: T[Property] & Construct<Parameters<T[Property]>>;
  };

  export type Factory = <T extends Schema>(init: Init) => IBuilder<T>;

  type ArrayType<T> = T extends (infer Item)[] ? Item : T;

  export interface Client<T extends Schema> {
    new (init: Init): Client<T>;
    call<P, R>(data: Call<P>): Promise<R | void>;
    config: (options: Config) => IBuilder<T>;
    cache: (options?: Cache.Config) => IBuilder<T>;
    abort: (signal: AbortController['signal']) => IBuilder<T>;
    opt: (options: Options) => IBuilder<T>;
    // TODO infer custom type for each return type
    batch: <T extends ArrayType<T>[]>(...calls: T) => unknown[];
  }

  export type IBuilder<T extends Schema> = Models<T> & Client<T>;

  export type Returned<T extends (...args: unknown[]) => unknown> = Awaited<ReturnType<T>>;
}
