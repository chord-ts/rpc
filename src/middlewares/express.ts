import type { Middleware } from '../types';

/**
 * The `expressMiddleware` function is a TypeScript function that creates an Express middleware that
 * sets the `ctx.body` property to the `event.body` value and calls the `next` function.
 * @returns A middleware function that will handle request event and extract body.
 * @example
 * ```typescript
 * import expressMiddleware from '@chord-ts/rpc/middlewares';
 * // ...
 * composer.use(expressMiddleware());
 * ```
 */
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
