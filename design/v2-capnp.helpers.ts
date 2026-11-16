// Cap'n Web-подобный RPC поверх chord gasket (ПРЕДЛАГАЕМОЕ API, спайк).
// Референс: cloudflare/capnweb — RpcTarget + newWorkersRpcResponse (сервер),
// newWebSocketRpcSession / newHttpBatchRpcSession<Api> (клиент), promise pipelining,
// capability-передача, человекочитаемый JSON-провод.
// Здесь: capnweb(composer) + connect<S>(send) поверх core.call; транспорт в спайке — loopback.
// Биндинг назван по протоколу, как jsonrpc/rest/mcp.
// Отличие от capnweb: у нас schema-first (fn-декларации валидируют вход/выход),
// у capnweb типы стёрты и валидация — отдельный пакет (capnweb-validate).
//
// Прогон (вместе с example):
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-capnp.example.ts

import type { AnySchema, ServiceMap, Result } from '../src/v2';
import type { Core } from './v2-transport.helpers';

// --- capability-маркер: схема «возвращает удалённый объект» ---
// В schema-first мире capability не сериализуется — это ссылка. Маркер прячет инстанс
// под Symbol.for (невидим для JSON/spread), сервер регистрирует его и отдаёт { $cap: id }.
// РАЗВИЛКА: вызовы методов capability в спайке идут напрямую в инстанс, минуя валидацию fn.

const CAP = Symbol.for('chord.capability');

export function capability<C extends new (...args: any[]) => any>(ctor: C): AnySchema<InstanceType<C>> {
  return {
    '~standard': {
      version: 1,
      vendor: 'chord',
      validate(value) {
        if (value && typeof value === 'object') {
          return { value: { [CAP]: value } as unknown as InstanceType<C> };
        }
        return { issues: [{ message: 'expected a capability object' }] };
      },
    },
  };
}

// --- провод: батч путей (JSON, как у capnweb) ---
// Путь = последовательность шагов от корня (null) или от результата предыдущего пути (from).
// Батч = все вызовы, накопленные до одного await → один round trip.

export type Step = { get: string } | { call: string; args: unknown[] };
export interface Path {
  from: number | null;
  steps: Step[];
}
export type Batch = Path[];

// --- сервер: capnweb(composer) — аналог RpcTarget + newWorkersRpcResponse ---

export interface ServerSession {
  resolve(batch: Batch, ctx?: unknown): Promise<unknown[]>;
  lastBatch: Batch | undefined;
}

export function capnweb(core: Core<any>): ServerSession {
  const caps: object[] = [];
  const results: unknown[] = []; // живут через батчи: from ссылается на глобальный индекс
  const session: ServerSession = {
    lastBatch: undefined,
    async resolve(batch, ctx) {
      session.lastBatch = batch;
      const deref = (i: number): unknown => {
        const r = results[i];
        return r && typeof r === 'object' && '$cap' in r ? caps[(r as { $cap: number }).$cap] : r;
      };
      for (const path of batch) {
        let value: unknown;
        let steps = path.steps;
        if (path.from == null) {
          // Корень: ведущие get + первый call = 'Service.method' → core.call (с валидацией).
          const names: string[] = [];
          let i = 0;
          while (i < steps.length && 'get' in steps[i]) {
            names.push((steps[i] as { get: string }).get);
            i++;
          }
          const first = steps[i] as { call: string; args: unknown[] } | undefined;
          if (!first) {
            // Промежуточный узел (namespace/метод без вызова) — placeholder, индексы сходятся.
            results.push(undefined);
            continue;
          }
          const r: Result = await core.call([...names, first.call].join('.'), first.args[0], { ctx });
          if (!r.ok) throw new Error(r.error.message);
          value = r.value;
          steps = steps.slice(i + 1);
        } else {
          value = deref(path.from);
        }
        for (const step of steps) {
          // Промежуточная capability разворачивается в инстанс (шаг идёт по её методам).
          if (value && typeof value === 'object' && CAP in value) {
            value = (value as Record<symbol, unknown>)[CAP];
          }
          if ('get' in step) {
            value = (value as Record<string, unknown>)[step.get];
          } else {
            value = await (value as Record<string, (...a: unknown[]) => unknown>)[step.call](...step.args);
          }
        }
        if (value && typeof value === 'object' && CAP in value) {
          const id = caps.length;
          caps.push((value as Record<symbol, unknown>)[CAP] as object);
          results.push({ $cap: id });
        } else {
          results.push(value);
        }
      }
      return results.slice(results.length - batch.length);
    },
  };
  return session;
}

// --- клиент: connect<S>(send) — аналог newHttpBatchRpcSession<Api> ---
// Proxy накапливает пути; await (then) регистрирует путь и флашит батч одним round trip.
// Типы: RpcPromise<T> = Promise<T> & проекция свойств/методов T для pipelining.

type MethodKeys<T> = { [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never }[keyof T];

type Pipelined<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => RpcPromise<Awaited<R>>
  : T extends object
    ? { [K in keyof T]: RpcPromise<T[K]> }
    : T;
export type RpcPromise<T> = Promise<T> & (T extends object ? Pipelined<T> : unknown);

type RemoteSvc<T> = {
  [M in MethodKeys<T>]: T[M] extends (...args: infer A) => infer R ? (...args: A) => RpcPromise<Awaited<R>> : never;
};
export type Session<S extends ServiceMap> = { [K in keyof S]: RemoteSvc<InstanceType<S[K]>> };

interface Node {
  // base != null → шаги относительны результата base (capability-стаб);
  // base == null → шаги абсолютны от корня, путь самодостаточен (from: null).
  base: Node | null;
  steps: Step[];
  id?: number;
}

export function connect<S extends ServiceMap>(send: (batch: Batch) => Promise<unknown[]>): Session<S> {
  const paths: Path[] = [];
  let sent = 0;
  let flight: { promise: Promise<unknown[]>; base: number } | undefined;

  // Флаш отложен на микротаск: все then одного синхронного блока регистрируются до отправки.
  const flush = () => {
    if (!flight) {
      const base = sent;
      const promise = Promise.resolve().then(() => {
        const batch = paths.slice(base);
        sent = paths.length;
        return send(batch);
      });
      flight = { promise, base };
      promise.then(
        () => { flight = undefined; },
        () => { flight = undefined; },
      );
    }
    return flight;
  };

  const register = (n: Node): number => {
    if (n.id === undefined) {
      const from = n.base ? register(n.base) : null;
      n.id = paths.length;
      paths.push({ from, steps: n.steps });
    }
    return n.id;
  };

  const make = (node: Node, callName?: string): any =>
    new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            const id = register(node);
            const f = flush();
            f.promise.then((rs) => {
              const r = rs[id - f.base];
              // capability → стаб: база = этот узел, шаги дальше относительны.
              resolve(r && typeof r === 'object' && '$cap' in r ? make({ base: node, steps: [] }) : r);
            }, reject);
          };
        }
        if (typeof prop === 'symbol') return undefined;
        return make({ base: node.base, steps: [...node.steps, { get: prop }] }, prop);
      },
      apply(_t, _this, args) {
        // Вызов заменяет последний get-шаг (имя метода) на call — иначе 'Service.method.method'.
        return make({ base: node.base, steps: [...node.steps.slice(0, -1), { call: callName!, args }] });
      },
    });

  return make({ base: null, steps: [] }) as Session<S>;
}