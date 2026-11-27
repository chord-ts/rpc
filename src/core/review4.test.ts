// Регрессии раунда 4: DI наследование/ES5 (#9), void/object params (#11),
// позиционный контракт методов без схемы (#12c), удаление compose-probe (#6).

import { expect, test } from 'vitest';
import { z } from 'zod';
import { compose, fn, paramNames } from '../index';
import { ZodAdapter } from '../schemas/zod';

test('#9: subclass without its own constructor inherits the base dep keys', async () => {
  class Base {
    constructor(public db: string) {}
  }
  class Child extends Base {
    static $name = fn({ in: z.void(), out: z.string() });
    name = async () => this.db;
  }
  expect(paramNames(Child)).toEqual(['db']);
  const core = compose({ Child }, { inject: { db: () => 'connection' } });
  expect(await core.call('Child.name', undefined)).toBe('connection');
});

test('#9: ES5-downlevelled class (no constructor source) fails fast at compose', () => {
  // Функция с параметрами, но без `constructor` в исходнике — paramNames не найдёт ключей.
  const Svc = function (a: unknown) {
    (this as { a?: unknown }).a = a;
  } as unknown as new (a: unknown) => { a: unknown };
  expect(() => compose({ Svc }, { inject: {} as never })).toThrow(/downlevelled|ES5|minified/);
});

test('#11: void schema accepts omitted / [] / {} params equivalently', async () => {
  class V {
    static $ping = fn({ in: z.void(), out: z.string() });
    ping = async () => 'pong';
  }
  const core = compose({ V }, { schemas: new ZodAdapter() });
  expect(await core.call('V.ping', undefined)).toBe('pong');
  expect(await core.call('V.ping', [])).toBe('pong');
  expect(await core.call('V.ping', {})).toBe('pong');
});

test('#11: object schema treats omitted / [] params as {}', async () => {
  class O {
    static $tz = fn({ in: z.object({ tz: z.string().optional() }), out: z.string() });
    tz = async ({ tz }: { tz?: string }) => tz ?? 'none';
  }
  const core = compose({ O }, { schemas: new ZodAdapter() });
  expect(await core.call('O.tz', undefined)).toBe('none');
  expect(await core.call('O.tz', [])).toBe('none');
  expect(await core.call('O.tz', { tz: 'utc' })).toBe('utc');
});

test('#12c: schema-less methods use the positional contract, not handler.length', async () => {
  class S {
    sum(a: number, b = 0) {
      return a + b;
    }
    rest(...xs: number[]) {
      return xs;
    }
  }
  const core = compose({ S });
  expect(await core.call('S.sum', [1, 2])).toBe(3); // default param: length=1, всё равно spread
  expect(await core.call('S.rest', [1, 2])).toEqual([1, 2]); // rest param: length=0
  expect(await core.call('S.sum', [5])).toBe(5); // [value] → один аргумент
});

test('#6: compose does not run inject factories (no probe) — async rejection cannot crash', () => {
  class Svc {
    constructor(public user: unknown) {}
    static $m = fn({ in: z.void(), out: z.string() });
    m = async () => 'ok';
  }
  let ran = false;
  // async-фабрика, падающая на заглушке: раньше probe вызывал её на compose и отклонённый
  // промис ронял процесс после возврата. Теперь compose фабрики не трогает.
  const core = compose(
    { Svc },
    {
      inject: {
        user: async () => {
          ran = true;
          throw new Error('needs a real ctx');
        },
      } as never,
    },
  );
  expect(ran).toBe(false);
  expect(typeof core.call).toBe('function');
});
