// Spike: ядро без валидатора (zero imports), fn() параметризована вендоренным AnySchema (~standard).
// Доказывает: типы выводятся из $hello.fn через InferOutput; Client из классов; #/private исключены.
// Прогон: npx tsc --noEmit --strict --target es2022 --module commonjs --moduleResolution node --skipLibCheck design/v2-schema-agnostic.spike.ts

// Вендоренный контракт схемы (стандартная форма: zod 4 / valibot / arktype её реализуют).
interface AnySchema<Output = unknown> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => { readonly value: Output } | { readonly issues: readonly unknown[] };
  };
}

type InferOutput<S extends AnySchema> = S extends AnySchema<infer O> ? O : never;

type Middleware = (ctx: unknown, next: () => Promise<unknown>) => Promise<unknown>;
type MaybeArray<T> = T | T[];

type Contract = {
  in: AnySchema<any>;
  out?: AnySchema<any>;
  use?: MaybeArray<Middleware>;
};

type Out<C extends Contract> = C['out'] extends AnySchema<infer O> ? O : unknown;

type Proced<C extends Contract> = C & {
  fn: (input: InferOutput<C['in']>) => Promise<Out<C>>;
};

function fn<C extends Contract>(c: C): Proced<C> {
  return c as unknown as Proced<C>;
}

// --- Client из классов ---
type AnyCtor = new (...args: any[]) => any;
type ServiceMap = Record<string, AnyCtor>;

type MethodKeys<T> = { [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never }[keyof T];
type RemoteMethod<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
type RemoteService<T> = { [K in MethodKeys<T>]: RemoteMethod<T[K]> };
type Client<S extends ServiceMap> = { [K in keyof S]: RemoteService<InstanceType<S[K]>> };

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// Фейковый адаптер как стенд-ин zod/valibot/...
function schema<O>(): AnySchema<O> {
  return { '~standard': { version: 1, vendor: 'fake', validate: (value) => ({ value: value as O }) } };
}

class Say {
  static $hello = fn({ in: schema<{ name: string }>(), out: schema<string>() });
  hello: typeof Say.$hello.fn = async (input) => `Hello, ${input.name}!`;

  static $count = fn({ in: schema<number>() }); // out опущен → возврат unknown
  count: typeof Say.$count.fn = async (n) => n + 1;

  #greet(name: string): string { return `Hello, ${name}!`; }
  private helper(): string { return 'internal'; }
}

declare function toRPC<S extends ServiceMap>(services: S): Client<S>;
const client = toRPC({ Say });

client.Say.hello({ name: 'world' }).then((s) => s.toUpperCase());
client.Say.count(1).then((n) => (n as number).toFixed());

// «схема → тип» без единого import конкретной библиотеки.
type _inferred = Equal<InferOutput<typeof Say.$hello.in>, { name: string }>;
const _inferred: _inferred = true;

type _hello = Equal<typeof client.Say.hello, (input: { name: string }) => Promise<string>>;
const _hello: _hello = true;

type _countUnknown = Equal<typeof client.Say.count, (input: number) => Promise<unknown>>;
const _countUnknown: _countUnknown = true;

// #/private не попадают в Client.
type _keys = Equal<keyof Client<{ Say: typeof Say }>['Say'], 'hello' | 'count'>;
const _keys: _keys = true;