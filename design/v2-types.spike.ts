// Spike: type contract of the REAL src/v2 core + zod adapter + zod 4 native.
// Proves: $method.fn infers input from schema; `out` omitted -> unknown;
// Client excludes #/private; Client wraps return in Promise; InferOutput; inject typed;
// zod 4 schemas plug in directly (native `~standard`, no adapter).
// Run: npx tsc --noEmit --strict --target es2022 --module commonjs --moduleResolution node --skipLibCheck design/v2-types.spike.ts
import { z } from 'zod';
import { z as z4 } from 'zod4';
import { fn, toRPC, type Client, type InferOutput, type Injector } from '../src/v2';
import { zod } from '../src/v2/validators/zod';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

class Say {
  static $hello = fn({ in: zod(z.string()), out: zod(z.string()) });
  hello: typeof Say.$hello.fn = async (name) => `Hello, ${name}!`;

  static $count = fn({ in: zod(z.number()) }); // out omitted -> unknown
  count: typeof Say.$count.fn = async (n) => n + 1;

  #greet(name: string): string {
    return `Hello, ${name}!`;
  }
  private helper(): string {
    return 'internal';
  }
}

// `$method.fn` infers the argument from `in` and the return from `out`.
type _helloInput = Equal<Parameters<typeof Say.$hello.fn>[0], string>;
const _helloInput: _helloInput = true;

type _helloOut = Equal<Awaited<ReturnType<typeof Say.$hello.fn>>, string>;
const _helloOut: _helloOut = true;

// `out` omitted -> handler return degrades to unknown.
type _countOut = Equal<Awaited<ReturnType<typeof Say.$count.fn>>, unknown>;
const _countOut: _countOut = true;

// Client: public arrow fields only, return wrapped in Promise.
type _client = Client<{ Say: typeof Say }>;

type _keys = Equal<keyof _client['Say'], 'hello' | 'count'>;
const _keys: _keys = true;

type _remote = Equal<_client['Say']['hello'], (input: string) => Promise<string>>;
const _remote: _remote = true;

type _remoteCount = Equal<_client['Say']['count'], (input: number) => Promise<unknown>>;
const _remoteCount: _remoteCount = true;

// InferOutput over the zod 3 adapter.
const strSchema = zod(z.string());
type _inferString = Equal<InferOutput<typeof strSchema>, string>;
const _inferString: _inferString = true;

const objSchema = zod(z.object({ name: z.string() }));
type _inferObj = Equal<InferOutput<typeof objSchema>, { name: string }>;
const _inferObj: _inferObj = true;

// --- inject typed from public parameter properties ---
type Ctx = { user: { name: string } };
type Logger = { log: (msg: string) => void };

class Api {
  constructor(
    public readonly ctx: Ctx,
    public readonly logger: Logger,
  ) {}

  static $ping = fn({ in: zod(z.string()), out: zod(z.string()) });
  ping: typeof Api.$ping.fn = async (s) => s;
}

// Keys are the dependency names (public data fields), not the arrow-field methods.
type _injKeys = Equal<keyof Injector<{ Api: typeof Api }>, 'ctx' | 'logger'>;
const _injKeys: _injKeys = true;

type _injCtx = Equal<Injector<{ Api: typeof Api }>['ctx'], (ctx: any) => Ctx>;
const _injCtx: _injCtx = true;

type _injLogger = Equal<Injector<{ Api: typeof Api }>['logger'], (ctx: any) => Logger>;
const _injLogger: _injLogger = true;

// Good: factories return the right dependency types.
toRPC({ Api }, {
  inject: {
    ctx: (e: { locals: Ctx }) => e.locals,
    logger: (e: { logger: Logger }) => e.logger,
  },
});

// @ts-expect-error missing `logger` dependency
toRPC({ Api }, { inject: { ctx: (e: { locals: Ctx }) => e.locals } });

// @ts-expect-error `ctx` factory must return Ctx, not number
toRPC({ Api }, { inject: { ctx: (_e: unknown) => 42, logger: (_e: unknown) => ({ log: (_m: string) => {} } as Logger) } });

// --- zod 4 native `~standard`: schemas accepted directly, no adapter ---
const z4str = z4.string();
type _z4string = Equal<InferOutput<typeof z4str>, string>;
const _z4string: _z4string = true;

const z4obj = z4.object({ name: z4.string() });
type _z4obj = Equal<InferOutput<typeof z4obj>, { name: string }>;
const _z4obj: _z4obj = true;

class Native {
  static $hello = fn({ in: z4.string(), out: z4.string() });
  hello: typeof Native.$hello.fn = async (name) => `Hello, ${name.toUpperCase()}!`;
}

type _nativeIn = Equal<Parameters<typeof Native.$hello.fn>[0], string>;
const _nativeIn: _nativeIn = true;

// Simple endpoint: public prototype method without `$method` lands in Client with its own type.
class Simple {
  async greet(name: string) {
    return `Hi ${name}`;
  }
  #hidden(): string {
    return 'no';
  }
}

type _simpleKeys = Equal<keyof Client<{ Simple: typeof Simple }>['Simple'], 'greet'>;
const _simpleKeys: _simpleKeys = true;

type _simpleRemote = Equal<Client<{ Simple: typeof Simple }>['Simple']['greet'], (name: string) => Promise<string>>;
const _simpleRemote: _simpleRemote = true;