// Spike: fn() + фантомное поле fn, zod как opt-in адаптер (взгляд пользователя).
// Доказывает: тип метода выводится из $hello.fn; Client строится из классов; #/private не попадают.
// Прогон: npx tsc --noEmit --strict --target es2022 --module commonjs --moduleResolution node --skipLibCheck design/v2-registration.spike.ts
import { z } from 'zod';

type Middleware = (ctx: unknown, next: () => Promise<unknown>) => Promise<unknown>;
type MaybeArray<T> = T | T[];

// --- fn(): schema-first, метод выводится из схемы ---
type Contract = {
  in: z.ZodTypeAny;
  out?: z.ZodTypeAny;
  use?: MaybeArray<Middleware>;
};

type ContractIn<C extends Contract> = z.infer<C['in']>;
type ContractOut<C extends Contract> = C['out'] extends z.ZodTypeAny ? z.infer<C['out']> : unknown;

type Proced<C extends Contract> = C & {
  fn: (input: ContractIn<C>) => Promise<ContractOut<C>>;
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

class Say {
  static $hello = fn({ in: z.string(), out: z.string() });
  hello: typeof Say.$hello.fn = async (name) => `Hello, ${name}!`;

  static $count = fn({ in: z.number() }); // out опущен → возврат unknown
  count: typeof Say.$count.fn = async (n) => n + 1;

  #greet(name: string): string { return `Hello, ${name}!`; }
  private helper(): string { return 'internal'; }
}

declare function toRPC<S extends ServiceMap>(services: S): Client<S>;
const client = toRPC({ Say });

client.Say.hello('world').then((s) => s.toUpperCase());
client.Say.count(1).then((n) => (n as number).toFixed());

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// hello с out → конкретный тип возврата.
type _hello = Equal<typeof client.Say.hello, (input: string) => Promise<string>>;
const _hello: _hello = true;

// count без out → возврат деградирует до unknown.
type _countUnknown = Equal<typeof client.Say.count, (input: number) => Promise<unknown>>;
const _countUnknown: _countUnknown = true;

// #/private не попадают в Client.
type _keys = Equal<keyof Client<{ Say: typeof Say }>['Say'], 'hello' | 'count'>;
const _keys: _keys = true;