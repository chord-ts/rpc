import type { MethodDescription, Middleware, IRPC } from '../types';
import { ErrorCode, type Request } from '../specs';
import { buildResponse, buildError, Value } from '../specs';

/* The `ICache` interface defines a contract for a cache object. It specifies two methods: `get` & `set`*/
export interface ICache {
  get(k: string): Promise<unknown>;
  set(k: string, v: unknown, ttl?: number | string): Promise<void>;
}

export function callToKey({ method, params }: IRPC.Call<unknown>): string {
  return `${method}(${JSON.stringify(params)})`;
}

/**
 * The `cacheMiddleware` function is a TypeScript function that returns a middleware function for
 * caching RPC method calls.
 * @param {ICache} cache - The `cache` parameter is an object that implements the `ICache` interface.
 * It is used to store and retrieve cached data.
 * @param {number | string} [ttl] - The `ttl` parameter stands for "time to live" and it determines how
 * long the cached data should be stored before it expires. It can be specified as a number
 * representing the time in milliseconds, or as a string representing a duration (e.g. "1h" for 1 hour,
 * @returns The function `cacheMiddleware` returns a middleware function.
 */
export function cacheMiddleware(cache: ICache, ttl?: number | string): Middleware<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> {
  // TODO
  return async function cacheIntercept(
    event,
    ctx,
    next
  ) {

    // if (!event?.call || !event?.methodDesc)
    //   throw TypeError('Cache Middleware can work only with RPC methods, not the Composer!');
    const { target, descriptor } = ctx.methodDesc as MethodDescription;

    const call = ctx.body as Request<Value[]>
    const cacheKey = callToKey(call as IRPC.Call<unknown>);
    const stored = await cache
      .get(cacheKey)
      .catch((e) => console.error(`Failed at read cache "${cacheKey}"\n`, e));

    if (stored) {
      // @ts-expect-error stored is Value
      return buildResponse({ request: ctx.body as Request<Value[]>, result: stored });
    }

    // Cached method must be Pure and isn't depended from context
    // That's why we skip DI stage
    let resp;
    let result;
    try {
      await next()
      result = await descriptor.value.apply(target, call.params);
      resp = buildResponse({
        request: ctx.body as Request<Value[]>,
        result
      });
    } catch (e) {
      console.error(e);
      resp = buildError({
        code: ErrorCode.InternalError,
        message: (e as { message?: string })?.message || '',
        data: [e]
      });
    } finally {
      cache.set(cacheKey, result, ttl).catch((e) => console.error('Failed at cache storing\n', e));
    }
    return resp;
  };
}

