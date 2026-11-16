import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, toRPC, ErrorCode } from '../../src';

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

function composer() {
  return toRPC({ Say }, {
    inject: {
      ctx: (e: Event) => e.locals,
      logger: (e: Event) => e.logger,
    },
  });
}

test('fn() stores the schema contract on the static and keeps `fn` phantom', () => {
  const contract = Say.$hello as unknown as Record<string, unknown>;
  expect(contract.in).toBeTruthy();
  expect(contract.out).toBeTruthy();
  expect('fn' in contract).toBe(false);
});

test('toRPC exposes instantiate and exec', () => {
  expect(typeof composer().instantiate).toBe('function');
  expect(typeof composer().exec).toBe('function');
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
  const res = await composer().exec({ method: 'Say.helper', id: 1 });
  expect(res).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: ErrorCode.MethodNotFound } });
});

test('public method without $method is a simple endpoint (no validation)', async () => {
  const res = await composer().exec({ method: 'Say.plain', params: 'x', id: 1 });
  expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: 'plain x' });
});