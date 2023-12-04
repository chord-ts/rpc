import type { MethodDescription, Call, Middleware } from '../types';
import { ErrorCode, type Request } from '../specs';
import { buildResponse, buildError } from '../specs';

export interface ICache {
  get(k: string): Promise<unknown>;
  set(k: string, v: unknown, ttl?: number | string): Promise<void>;
}

function callToKey({ method, params }: Call): string {
  return `${method}(${JSON.stringify(params)})`;
}

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

