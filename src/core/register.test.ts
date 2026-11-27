import { expect, test } from 'vitest';
import { minify } from 'terser';
import { z } from 'zod';
import { fn, compose, ErrorCode, type AnyCtor } from '../index';
import { envelope } from '../test-utils';

type Ctx = { user: { id: string; name: string } };
type Logger = { log: (msg: string) => void };
type Event = { locals: Ctx; logger: Logger };

export class Say {
  constructor(
    public readonly ctx: Ctx,
    public readonly logger: Logger,
  ) {}

  static $hello = fn({ in: z.string(), out: z.string() });

  hello: typeof Say.$hello.fn = async (name) => {
    this.logger.log(`hello("${name}")`);
    return `hello ${name}, logged in as ${this.ctx.user.name}`;
  };

  async plain(name: string) {
    return `plain ${name}`;
  }

  #greet(name: string): string {
    return `Hello, ${name}!`;
  }

  #helper(): string {
    return 'internal';
  }
}

function makeEvent(logs: string[]): Event {
  return {
    locals: { user: { id: '1', name: 'dmdin' } },
    logger: { log: (msg) => logs.push(msg) },
  };
}

const options = {
  inject: {
    ctx: (e: Event) => e.locals,
    logger: (e: Event) => e.logger,
  },
};
function composer() {
  return compose({ Say }, options);
}
const exec = envelope({ Say }, options);

test('fn() stores the schema contract on the static and keeps `fn` phantom', () => {
  const contract = Say.$hello as unknown as Record<string, unknown>;
  expect(contract.in).toBeTruthy();
  expect(contract.out).toBeTruthy();
  expect('fn' in contract).toBe(false);
});

test('compose exposes instantiate/call; jsonrpc binding serves the envelope', async () => {
  expect(typeof composer().instantiate).toBe('function');
  expect(typeof composer().call).toBe('function');
  const res = await exec({ method: 'Say.plain', params: 'x', id: 1 });
  expect(res).toMatchObject({ jsonrpc: '2.0', id: 1, result: 'plain x' });
});

test('instantiate builds a fresh instance per event with constructor DI', async () => {
  const logs: string[] = [];
  const c = composer();

  const a = c.instantiate(makeEvent(logs)).Say;
  const b = c.instantiate(makeEvent(logs)).Say;

  expect(a).toBeInstanceOf(Say);
  expect(a).not.toBe(b);
  expect(await a.hello('world')).toBe('hello world, logged in as dmdin');
  expect(logs).toEqual(['hello("world")']);
});

test('#/private members are not endpoints', async () => {
  const res = await exec({ method: 'Say.helper', id: 1 });
  expect(res).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: ErrorCode.MethodNotFound } });
});

test('public method without $method is a simple endpoint (no validation)', async () => {
  const res = await exec({ method: 'Say.plain', params: 'x', id: 1 });
  expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: 'plain x' });
});

// Симуляция минифицированного бандла: параметр конструктора переименован ('t'),
// поле-свойство ('ctx') переживает — имена свойств дефолтные минификаторы не трогают.
// paramNames читает 't', inject ключуется по 'ctx' — расхождение.
class Mangled {
  readonly ctx: Ctx;
  constructor(t: Ctx) {
    this.ctx = t;
  }
  static $hello = fn({ in: z.string(), out: z.string() });
  hello: typeof Mangled.$hello.fn = async (name) => `hello ${name} as ${this.ctx.user.name}`;
}

class MangledAnnotated {
  static $constructor = ['ctx'];
  readonly ctx: Ctx;
  constructor(t: Ctx) {
    this.ctx = t;
  }
  static $hello = fn({ in: z.string(), out: z.string() });
  hello: typeof MangledAnnotated.$hello.fn = async (name) => `hello ${name} as ${this.ctx.user.name}`;
}

test('DI: mangled parameter name fails at compose and suggests $constructor', () => {
  const inject = { inject: { ctx: (e: Event) => e.locals } };
  expect(() => compose({ Mangled }, inject)).toThrow(/no inject factory for dependency "t"/);
  expect(() => compose({ Mangled }, inject)).toThrow(/minified/);
  expect(() => compose({ Mangled }, inject)).toThrow(/\$constructor/);
});

test('DI: static $constructor restores injection under mangled parameter names', async () => {
  const c = compose({ MangledAnnotated }, { inject: { ctx: (e: Event) => e.locals } });
  const res = await c.call('MangledAnnotated.hello', 'world', { ctx: makeEvent([]) });
  expect(res).toBe('hello world as dmdin');
  const instance = c.instantiate(makeEvent([])).MangledAnnotated;
  expect(await instance.hello('x')).toBe('hello x as dmdin');
});

// Прув настоящим минификатором: terser манглит параметр конструктора, но сохраняет
// имя свойства ($constructor) и строковый литерал ('ctx') — аннотация переживает бандл.
test('DI: real terser minification — guard without $constructor, injection works with it', async () => {
  const body = `constructor(ctx) { this.ctx = ctx; } async hello(name) { return 'hi ' + name + ' as ' + this.ctx.user.name; }`;
  const minifiedClass = async (src: string) => {
    const { code } = await minify(`${src} export { S };`, { mangle: true, compress: true, ecma: 2020, module: true });
    const mod = await import(`data:text/javascript,${encodeURIComponent(code!)}`);
    return mod.S as AnyCtor;
  };

  const MangledReal = await minifiedClass(`class S { ${body} }`);
  expect(() => compose({ MangledReal }, { inject: { ctx: (e: Event) => e.locals } })).toThrow(/\$constructor/);

  const AnnotatedReal = await minifiedClass(`class S { static $constructor = ['ctx']; ${body} }`);
  const c = compose({ AnnotatedReal }, { inject: { ctx: (e: Event) => e.locals } });
  expect(await c.call('AnnotatedReal.hello', 'world', { ctx: makeEvent([]) })).toBe('hi world as dmdin');
});