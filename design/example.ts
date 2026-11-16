// Канонический пример регистрации (core fn). Только пользовательский код, импортирует src.
// Механика — в src (core/schemas/…); типы проверены тестами tests/v2.
// Прогон типов:
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/example.ts

import { z } from 'zod';
import { fn, compose, type Middleware } from '../src';

type Ctx = { user: { id: string; name: string } };
type Event = { locals: Ctx };

const logCalls: Middleware = async (ctx, next) => next(ctx);

export class Say {
  // DI: фреймворк сам делает new Say(ctx), подставляя вычисленный контекст.
  constructor(public readonly ctx: Ctx) {}

  static $hello = fn({ in: z.string(), out: z.string(), use: [logCalls] });

  // Метод — поле-стрелка: тип берётся из $hello.fn, аргумент выводится сам.
  hello: typeof Say.$hello.fn = async (name) => {
    return `hello ${name}, logged in as ${this.ctx.user.name}`;
  };

  // Не эндпоинт: нативный приват невидим в реестре.
  #greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

// Регистрация: ключи inject совпадают с именами параметров конструктора.
const composer = compose({ Say }, { inject: { ctx: (e: Event) => e.locals } });

// Использование: call — протокол-агностичный глагол ядра.
const event: Event = { locals: { user: { id: '1', name: 'dmdin' } } };
const result = await composer.call('Say.hello', 'world', { ctx: event.locals });
if (result.ok) console.log(result.value);

// instantiate — свежий инстанс на запрос с constructor DI.
const say = composer.instantiate(event.locals).Say;
console.log(await say.hello('world'));