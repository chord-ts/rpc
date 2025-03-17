import type * as JSONRPC from '../specs';

export type Transport = <T, K extends JSONRPC.Parameters>(
  data: {
    route: string;
    body: T;
    format: Format;
  },
  opt?: object
) => Promise<JSONRPC.SomeResponse<K> | JSONRPC.BatchResponse<K>>;

export type Format = {
  parse: (r: Response) => object;
  stringify: <T>(r: T) => string;
}

export type ErrorCallback = <T>(e: Error, req: JSONRPC.Request<JSONRPC.Parameters>) => Promise<T> | never;

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
    format?: Format;
    cache?: Cache.Storage;
    onError?: ErrorCallback;
  }

  export interface Options {
    [k: string]: unknown;
    signal?: AbortController['signal'];
  }

  export interface Init {
    endpoint: string;
    config?: Config;
    options?: Options;
    
  }

  export interface Overridable {
    config?: Config;
    options?: Options;
  }


  export type Schema = { [model: string]: { [method: string]: (...args: unknown[]) => unknown } };

  type Models<T extends Schema> = {
    [Property in keyof T]: Methods<T[Property]>;
  };

  interface Construct<T extends JSONRPC.Value[]> {
    new (...args: T): JSONRPC.Request<T>;
  }

  // Not necessary if methods in class are async
  // type Promised<F extends (...args: any) => any> = (
  //   ...args: JSONRPC.Parameters<F>
  // ) => Promise<ReturnType<F>>;

  type Methods<T extends Schema[keyof Schema]> = {
    // @ts-ignore
    [Property in keyof T]: T[Property] & Construct<JSONRPC.Parameters<T[Property]>>;
  };

  export type Factory = <T extends Schema>(init: Init) => Builder<T>;

  type ArrayType<T> = T extends (infer Item)[] ? Item : T;

  export interface Client<T extends Schema> {
    new (init: Init): Client<T>;
    call<P, R>(data: Call<P>): Promise<R | void>;
    config: (options: Config) => Builder<T>;
    cache: (options?: Cache.Config) => Builder<T>;
    abort: (signal: AbortController['signal']) => Builder<T>;
    opt: (options: Options) => Builder<T>;
    // TODO infer custom type for each return type
    batch: <T extends ArrayType<T>[]>(...calls: T) => unknown[];
  }

  export type Builder<T extends Schema> = Models<T> & Client<T>;

  export type Returned<T extends (...args: unknown[]) => unknown> = Awaited<ReturnType<T>>;
}
