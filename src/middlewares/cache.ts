import type { MethodDescription, Call, Middleware } from '../types';
import { ErrorCode, type Request } from '../specs';
import { buildResponse, buildError } from '../specs';

/* The `ICache` interface defines a contract for a cache object. It specifies two methods: `get` & `set`*/
export interface ICache {
  get(k: string): Promise<unknown>;
  set(k: string, v: unknown, ttl?: number | string): Promise<void>;
}

function callToKey({ method, params }: Call): string {
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
export function cacheMiddleware(cache: ICache, ttl?: number | string): Middleware {
  return async function cacheIntercept(
    event: Record<string, unknown>,
    ctx: Record<string, unknown>
  ) {
    if (!event?.call || !event?.methodDesc)
      throw TypeError('Cache Middleware can work only with RPC methods, not the Composer!');

    const { target, descriptor } = event.methodDesc as MethodDescription;
    const cacheKey = callToKey(event.call as Call);
    const stored = await cache
      .get(cacheKey)
      .catch((e) => console.error(`Failed at read cache "${cacheKey}"\n`, e));
    const call = event.call as Call;

    if (stored) {
      return buildResponse({ request: event.raw as Request, result: stored });
    }

    // Cached method must be Pure and isn't depended from context
    // That's why we skip DI stage
    let resp;
    let result;
    try {
      result = await descriptor.value.apply(target, call.params.concat(ctx));
      resp = buildResponse({
        request: event.raw as Request,
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

