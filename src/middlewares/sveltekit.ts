import type { Middleware } from '../types';


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


