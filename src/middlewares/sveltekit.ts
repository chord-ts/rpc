import type { Middleware } from '../types';


/**
 * The `sveltekitMiddleware` function is a middleware for SvelteKit that extracts JSON data from the
 * request and assigns it to the `ctx.body` property, while also merging the `event.locals` object into
 * the `ctx` object.
 * @returns A middleware function that will handle request event and extract body.
 * @example
 * ```ts
 * import { sveltekitMiddleware } from '@chord-ts/rpc/middlewares'
 * // ...
 * composer.use(sveltekitMiddleware());
 * ```
 */
export function sveltekitMiddleware() {
  const middleware: Middleware = async (
    event: Record<string, unknown> | { request: Request; locals: unknown },
    ctx: Record<string, unknown>,
    next: CallableFunction
  ) => {
    if (!event?.request || !event?.locals) {
      throw TypeError('Use this middleware only with SvelteKit. Pass RequestEvent to exec function');
    }
    // @ts-expect-error json method is defined by Request object
    ctx.body = await event.request.json();
    Object.assign(ctx, event.locals);
    next();
  };
  return middleware
}


