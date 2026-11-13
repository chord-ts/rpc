import { z } from 'zod';

// --- middleware ---
export type Middleware = (ctx: unknown, next: () => Promise<unknown>) => Promise<unknown>;
type MaybeArray<T> = T | T[];

// --- контракт процедуры + fn() ---
type Contract = {
  in: z.ZodTypeAny;
  out?: z.ZodTypeAny;
  use?: MaybeArray<Middleware>;
};

type ContractIn<C extends Contract> = z.infer<C['in']>;
type ContractOut<C extends Contract> = C['out'] extends z.ZodTypeAny ? z.infer<C['out']> : unknown;

type Proced<C extends Contract> = C & {
  fn: (input: ContractIn<C>) => ContractOut<C> | Promise<ContractOut<C>>;
};

// Декларирует процедуру и возвращает контракт с фантомным полем `fn` — типом обработчика.
export function fn<C extends Contract>(c: C): Proced<C> {
  return c as unknown as Proced<C>;
}

// --- DI + toRPC() ---
type AnyCtor = new (...args: any[]) => any;
type ServiceMap = Record<string, AnyCtor>;
export type Injector<E = any> = Record<string, (event: E) => any>;

type Instantiated<S extends ServiceMap> = { [K in keyof S]: InstanceType<S[K]> };

// Имена параметров конструктора — тот же приём, что для аргументов методов (парсинг fn.toString()).
function paramNames(fn: any): string[] {
  const src: string = fn.toString();
  const head = src.slice(src.indexOf('(') + 1, src.indexOf(')'));
  const args = head.match(/([^\s,]+)/g);
  return args ?? [];
}

export function toRPC<S extends ServiceMap>(
  services: S,
  options: { inject: Injector },
): { instantiate(event: any): Instantiated<S> } {
  return {
    instantiate(event: any): Instantiated<S> {
      const built: Record<string, unknown> = {};
      for (const key of Object.keys(services) as (keyof S)[]) {
        const Ctor = services[key] as AnyCtor;
        const deps: any[] = paramNames(Ctor).map((name) => options.inject[name](event));
        built[key as string] = new Ctor(...deps);
      }
      return built as unknown as Instantiated<S>;
    },
  };
}