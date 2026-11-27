import type { Middleware, Event } from '../types';


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

type SvelteKitEvent = Event & { request: Request; locals: object }
type Locals = Record<string, unknown>

export function sveltekitMiddleware() {
  const backendAdapter: Middleware<SvelteKitEvent, Locals, Locals > = async (
    event: SvelteKitEvent,
    ctx: Locals,
    next: CallableFunction
  ) => {
    if (!event?.request || !event?.locals) {
      throw TypeError('Use this adapter only with SvelteKit. Pass RequestEvent to exec function');
    }
    ctx.body = await event.request.json();
    Object.assign(ctx, event.locals);
    next();
  
  };
  return backendAdapter
}

