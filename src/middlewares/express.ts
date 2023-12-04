import type { Middleware } from '../types';

export function expressMiddleware() {
  const middleware: Middleware = async (
    event: Record<string, unknown> | { body: unknown },
    ctx: Record<string, unknown>,
    next: CallableFunction
  ) => {
    ctx.body = event.body;
    next();
  };
  return middleware
}
