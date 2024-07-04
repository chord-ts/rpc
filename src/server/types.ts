import type { Error, BatchRequest, SomeResponse, BatchResponse } from '../specs';
import type { Composer } from '.';
import type { ValidateAdapter } from 'src/validators/type';


export interface MethodDescription {
  key: PropKey;
  descriptor: PropertyDescriptor;
  target: Target;
  validators: Validators;
  argNames: string[];
  metadata: MethodMetadata;
  use: Middleware<Event, Context, {}>[];
}

export interface PartialMethodDescription {
  key: PropKey;
  descriptor?: PropertyDescriptor;
  target: Target;
  validators?: Validators;
  argNames?: string[];
  metadata?: MethodMetadata;
  use?: Middleware<Event, Context, {}>[];
}

export interface Validators {
  in?: {[k: number]: unknown};
  out?: unknown;
}

export interface MethodConfig extends Validators {
  use?: Middleware<Event, Context, {}> | Middleware<Event, Context, {}>[];
}

export interface PropertyDescription {
  key: PropKey;
  target: Target;
}

export interface MethodMetadata {
  returnType?: string;
  argsType?: string[];
}

export interface Schema {
  route: string;
  methods: Record<string, MethodMetadata>;
  models: string[];
}

export interface ComposerConfig {
  route?: string;
  onError?: ErrorCallback;
  validator?: ValidateAdapter
}

export interface Target {
  constructor: { name: string };
}

export type PropKey = string | symbol;
export type ClassConstructor<T extends object> = new (...params: unknown[]) => T;

export type Middleware<Event, Ctx, Extension> = (
  event: Event,
  ctx: Ctx,
  next: CallableFunction
) => Promise<(Ctx & Extension) | void>;

// export type InjectedModels<T> = {
//   [Property in keyof T]: ModifiedMethods<T[Property]>;
// };

export type Composed<T extends { [s: string]: unknown }> = Composer<T> & T;

export type Event = {
  request: Request;
  [key: string]: unknown;
} | Request;

export type Context = Record<string, unknown>;

export type ModifiedContext<T> = T extends (infer Mw)[]
  ? Awaited<ReturnType<Mw>>
  : T;
