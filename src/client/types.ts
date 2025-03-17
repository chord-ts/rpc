import type { Request, Error, SomeResponse, BatchResponse, Parameters, Value } from '../specs';

export type Transport = <T, K extends Parameters>(
  data: {
    route: string;
    body: T;
    parser: (r: unknown) => object
  },
  opt?: object
) => Promise<SomeResponse<K> | BatchResponse<K>>;

export type ErrorCallback = <T>(e: Error, req: Request<Parameters>) => Promise<T> | never;

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
    parser?: (r: Response) => object;
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

  interface Construct<T extends Value[]> {
    new (...args: T): Request<T>;
  }

  // Not necessary if methods in class are async
  // type Promised<F extends (...args: any) => any> = (
  //   ...args: Parameters<F>
  // ) => Promise<ReturnType<F>>;

  type Methods<T extends Schema[keyof Schema]> = {
    // @ts-ignore
    [Property in keyof T]: T[Property] & Construct<Parameters<T[Property]>>;
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
