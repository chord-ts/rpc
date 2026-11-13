import { z } from 'zod';
import { fn, toRPC, type Middleware } from './helpers';

// --- домен пользователя ---
type Ctx = { user: { id: string; name: string } };
type Logger = { log: (msg: string) => void };
type Event = { locals: Ctx; logger: Logger };

const logCalls: Middleware = async (_ctx, next) => next();

export class Say {
  constructor(
    public readonly ctx: Ctx,
    public readonly logger: Logger,
  ) {}

  static $hello = fn({
    in: z.string(),
    out: z.string(),
    use: logCalls,
  });

  hello: typeof Say.$hello.fn = (name) => {
    this.logger.log(`hello("${name}")`);
    return `hello ${name}, logged in as ${this.ctx.user.name}`;
  };

  static $count = fn({
    in: z.number(),
  });

  count: typeof Say.$count.fn = (n) => {
    return n + 1;
  };

  // Приватные методы не попадают в эндпоинты.
  #greet(name: string): string {
    return `Hello, ${name}!`;
  }

  private helper(): string {
    return 'internal';
  }
}

// Регистрация сервиса и DI.
const composer = toRPC(
  { Say },
  {
    inject: {
      ctx: (event: Event) => event.locals,
      logger: (event: Event) => event.logger,  
    },
  },
);

// Эксплуатация: на каждый запрос — свежий инстанс.
const event: Event = {
  locals: { user: { id: '1', name: 'dmdin' } },
  logger: { log: (msg) => console.log(msg) },
};

const say = composer.instantiate(event).Say;
say.hello('world');
say.count(2);