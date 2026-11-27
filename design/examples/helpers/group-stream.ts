// Group-stream — вариант 3b (ПРЕДЛАГАЕМАЯ механика, дизайн-спайк). Src не тронут.
// Декларация stream({ in, event, group, backpressure }) несёт типизированные хэндлы
// publish(key, event) / subscribe(key, signal) — без magic strings, типы из схемы.
// Общий генератор на группу (дедуп по ключу): обработчик (input, signal) тапает subscribe-хэндл
// и деривирует события; fan-out / refcount / per-subscriber backpressure держит канал ядра.
// Связь applyUpdate → events — явный publish в канал комнаты. Транспорт подписки — тот же
// stream-шов (value → AsyncIterable), fromWsStream/SSE не меняются.

import {
  compose as baseCompose,
  paramNames,
  CoreError,
  type AnySchema,
  type InferOutput,
  type ServiceMap,
} from '../../../src';

export type Backpressure = 'reliable' | 'lossy';

const GROUP = Symbol.for('chord.group-stream');

// --- канал на группу: fan-out + per-subscriber очередь + backpressure + refcount ---

type Sub<T> = { queue: T[]; notify?: () => void; done: boolean; err?: unknown };

class Channel<T> {
  private subs = new Set<Sub<T>>();
  constructor(private policy: Backpressure = 'reliable', private limit = 64) {}

  publish(value: T): void {
    for (const s of this.subs) {
      if (s.done) continue;
      if (this.policy === 'lossy' && s.queue.length >= this.limit) s.queue.shift(); // drop oldest
      s.queue.push(value);
      // reliable: буфер без потерь; переполнение → disconnect подписчика (остальные не страдают)
      if (this.policy === 'reliable' && s.queue.length > this.limit) {
        s.err = new CoreError('invalid-output', 'Subscriber buffer overflow (reliable backpressure)');
        s.done = true;
      }
      s.notify?.();
    }
  }

  close(): void { for (const s of this.subs) { s.done = true; s.notify?.(); } }
  error(e: unknown): void { for (const s of this.subs) { s.err = e; s.done = true; s.notify?.(); } }
  get size(): number { return this.subs.size; }

  subscribe(signal?: AbortSignal): AsyncIterable<T> {
    const s: Sub<T> = { queue: [], done: false };
    this.subs.add(s);
    const cleanup = () => { s.done = true; this.subs.delete(s); s.notify?.(); };
    signal?.addEventListener('abort', cleanup, { once: true });
    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<T>> => {
          while (s.queue.length === 0 && !s.done) await new Promise<void>((r) => { s.notify = r; });
          if (s.err) { cleanup(); throw s.err; }
          if (s.queue.length > 0) return { value: s.queue.shift() as T, done: false };
          cleanup();
          return { value: undefined as never, done: true };
        },
        return: async (): Promise<IteratorResult<T>> => { cleanup(); return { value: undefined as never, done: true }; },
      }),
    };
  }
}

// --- декларация group-stream с типизированными хэндлами ---

export interface GroupStreamContract {
  in: AnySchema<any>;
  event: AnySchema<any>;
  group: (input: any) => string;
  backpressure?: Backpressure;
  desc?: string;
}

export function stream<C extends GroupStreamContract>(c: C) {
  const inputs = new Map<string, Channel<InferOutput<C['event']>>>();
  const inputFor = (key: string) => {
    let ch = inputs.get(key);
    if (!ch) { ch = new Channel<InferOutput<C['event']>>(c.backpressure ?? 'reliable'); inputs.set(key, ch); }
    return ch;
  };
  return {
    ...c,
    [GROUP]: true as const,
    /** Типизированный publish в канал группы (ключ = комната). */
    publish(key: string, event: InferOutput<C['event']>): void { inputFor(key).publish(event); },
    /** Типизированный subscribe на сырой feed группы (его тапает обработчик-генератор). */
    subscribe(key: string, signal?: AbortSignal): AsyncIterable<InferOutput<C['event']>> { return inputFor(key).subscribe(signal); },
    /** Фантомный тип обработчика: (input, signal) → AsyncIterable<event> (сигнатура как у stream). */
    fn: undefined as unknown as (input: InferOutput<C['in']>, signal: AbortSignal) => AsyncIterable<InferOutput<C['event']>>,
  };
}

// --- group-aware compose: дедуп генератора на группу + fan-out производных событий ---

class Runner {
  private output: Channel<unknown>;
  private ac = new AbortController();
  private refs = 0;
  private started = false;
  constructor(private g: any, private input: unknown, private ctx: unknown, private services: any, private options: any) {
    this.output = new Channel(g.decl.backpressure ?? 'reliable');
  }

  subscribe(signal?: AbortSignal): AsyncIterable<unknown> {
    this.refs++;
    if (!this.started) { this.started = true; this.start(); }
    const inner = this.output.subscribe(signal)[Symbol.asyncIterator]();
    let released = false;
    const release = () => { if (!released) { released = true; if (--this.refs <= 0) { this.ac.abort(); this.output.close(); } } };
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => { const r = await inner.next(); if (r.done) release(); return r; },
        return: async () => { release(); await inner.return?.(); return { value: undefined as never, done: true }; },
      }),
    };
  }

  private async start(): Promise<void> {
    const Ctor = this.services[this.g.service];
    const inject = (this.options?.inject ?? {}) as Record<string, (ctx: any) => any>;
    const deps = paramNames(Ctor).map((n) => inject[n]?.(this.ctx));
    const instance = new Ctor(...deps);
    const handler = instance[this.g.method];
    try {
      // обработчик тапает subscribe-хэндл декларации (сырой feed) и деривирует события
      for await (const e of handler.call(instance, this.input, this.ac.signal)) this.output.publish(e);
    } catch (e) {
      this.output.error(e);
    } finally {
      this.output.close();
    }
  }
}

export function compose<S extends ServiceMap>(services: S, options?: { inject?: Record<string, (ctx: any) => any> }) {
  const base = baseCompose(services, options as any);
  const groups = new Map<string, { decl: any; service: string; method: string }>();
  for (const [service, Ctor] of Object.entries(services)) {
    for (const [key, val] of Object.entries(Ctor)) {
      if (key.startsWith('$') && val && (val as any)[GROUP]) {
        groups.set(`${service}.${key.slice(1)}`, { decl: val, service, method: key.slice(1) });
      }
    }
  }
  const runners = new Map<string, Runner>();

  function stream(method: string, params: unknown, opts?: { ctx?: unknown; signal?: AbortSignal }): AsyncIterable<unknown> {
    const g = groups.get(method);
    if (!g) return base.stream(method, params, opts); // обычный unicast stream — без изменений
    const key = g.decl.group(params);
    const rk = `${method}|${key}`;
    let r = runners.get(rk);
    if (!r) { r = new Runner(g, params, opts?.ctx, services, options); runners.set(rk, r); }
    return r.subscribe(opts?.signal);
  }

  return { ...base, stream };
}
