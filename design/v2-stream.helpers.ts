// Stream — третий глагол gasket (ПРЕДЛАГАЕМОЕ API, дизайн-спайк, v4 формы).
// Решение по развилкам:
//   1. отдельная декларация stream({ in, event });
//   2. обработчик — асинхронный генератор async function* (input, signal);
//   3. один compose — stream рядом с call/notify;
//   4. НАТИВНЫЕ ошибки вместо Result: gasket yield'ит голые события AsyncIterable<Event>,
//      ошибки — typed throw (CoreError) / отмена — AbortError. Async-iterable уже несёт ошибку
//      нативно (next() → Promise reject, for-await пробрасывает), Result дублировал бы канал.
// SSE/WS-фрейминг — работа транспортного адаптера (потребляет iterable напрямую).
//
// Прогон (вместе с example):
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-stream.example.ts

import {
  compose as coreCompose,
  paramNames,
  CoreError,
  type AnyCtor,
  type AnySchema,
  type InferOutput,
  type Injector,
  type Middleware,
  type ServiceMap,
} from '../src';

export { fn, CoreError } from '../src'; // унарная декларация и ошибка ядра — из src

// --- декларация stream({ in, event }) ---

type MaybeArray<T> = T | T[];
type StreamContract = {
  in: AnySchema<any>;
  event: AnySchema<any>;
  use?: MaybeArray<Middleware<any>>;
  desc?: string;
};

type StreamFn<C extends StreamContract> = C & {
  fn: (input: InferOutput<C['in']>, signal: AbortSignal) => AsyncIterable<InferOutput<C['event']>>;
};

export function stream<C extends StreamContract>(c: C): StreamFn<C> {
  return c as unknown as StreamFn<C>;
}

// --- один compose: call/notify (src) + stream ---

export interface StreamOpts {
  ctx?: unknown;
  signal?: AbortSignal;
}

export function compose<S extends ServiceMap>(services: S, options: { inject: Injector<S> }) {
  const base = coreCompose(services, options);
  const inject = options.inject as unknown as Record<string, (ctx: any) => any>;
  const streams = new Map(
    base.endpoints().filter((e) => e.contract?.event).map((e) => [`${e.service}.${e.method}`, e.contract!]),
  );

  // Голые события + нативный throw. Ошибка терминальна (поток завершается), как у async-iterable.
  async function* stream(method: string, params: unknown, opts?: StreamOpts): AsyncIterable<unknown> {
    const contract = streams.get(method);
    if (!contract) throw new CoreError('not-found', `Not a stream method: ${method}`);

    const parsedIn = await contract.in['~standard'].validate(params);
    if ('issues' in parsedIn) throw new CoreError('invalid-params', 'Validation error', parsedIn.issues);

    const [service, name] = method.split('.');
    const Ctor = services[service as keyof S] as AnyCtor;
    const ctx = opts?.ctx ?? {};
    const deps = paramNames(Ctor).map((n) => inject[n](ctx));
    const instance = new Ctor(...deps);
    const handler = instance[name] as (input: unknown, signal: AbortSignal) => AsyncIterable<unknown>;
    const signal = opts?.signal ?? new AbortController().signal;
    const eventSchema = contract.event as AnySchema;

    // for-await пробрасывает throw обработчика нативно и вызывает return() при break → finally-cleanup.
    for await (const event of handler(parsedIn.value, signal)) {
      if (signal.aborted) throw new DOMException('The stream was aborted', 'AbortError');
      const parsed = await eventSchema['~standard'].validate(event);
      if ('issues' in parsed) throw new CoreError('invalid-output', 'Event validation error', parsed.issues);
      yield parsed.value;
    }
  }

  return { ...base, stream };
}