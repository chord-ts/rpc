import type {
  Schema,
  ClientConfig,
  Transport,
  ErrorCallback,
  Client,
  CacheStorage,
  CacheGetter,
  CacheSetter,
  CacheConfig
} from './types';

import type { FailedResponse, Response, BatchRequest, BatchResponse } from './specs';
import { buildRequest } from './specs';

const defaultTransport: Transport = async ({ route, body }) => {
  return await fetch(route, { method: 'POST', body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => {
      return { error: { message: 'Failed durning fetch request' } } as FailedResponse;
    });
};

const defaultCache: CacheStorage = (config?) => {
  const storageKey = '__chord_cache__';
  const expiry = config?.expiry ?? 1000 * 60 * 5; // 5 min by default

  function call2Key(method: string, params: unknown) {
    return `${method}(${JSON.stringify(params)})`;
  }
  const get: CacheGetter = ({ method, params }) => {
    if (typeof localStorage === 'undefined') return null;
    const store = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    const callKey = call2Key(method, params);
    const cached = store[callKey];

    if (!cached) return null;
    if (Date.now() - Date.parse(cached?.time) > expiry) {
      return null;
    }
    return cached?.result;
  };

  const set: CacheSetter = ({ method, params }, result) => {
    if (typeof localStorage === 'undefined') return null;
    const store = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    const callKey = call2Key(method, params);
    store[callKey] = { result, time: new Date() };

    localStorage.setItem(storageKey, JSON.stringify(store));
  };

  return { get, set };
};

const defaultErrorCallback: ErrorCallback = async (e, { method, params }) => {
  console.error(
    `Error occurred during RPC Call: ${method}(${params.map((p) => JSON.stringify(p)).join(',')})`
  );
  throw new EvalError(e.message);
};

// https://bobbyhadz.com/blog/javascript-check-if-value-is-promise
function isPromise(p: unknown) {
  if (
    p !== null &&
    typeof p === 'object' &&
    // @ts-expect-error: we check if p is Promise
    typeof p?.then === 'function' &&
    // @ts-expect-error: we check if p is Promise
    typeof p?.catch === 'function'
  ) {
    return true;
  }
  return false;
}

function initClient({ schema, config }: { schema: Schema; config?: ClientConfig }) {
  const transport = config?.transport ?? defaultTransport;
  const errorCallback = config?.onError ?? defaultErrorCallback;
  const cacheStorage = config?.cache ?? defaultCache;

  function call(method: string) {
    return async (params: unknown[]) => {
      const body = buildRequest({ method, params });
      const res = await transport({ route: schema.route, body });
      if ((res as FailedResponse).error) {
        return await errorCallback((res as FailedResponse).error, body);
      }
      return (res as Response).result;
    };
  }

  async function batch(...calls: BatchRequest) {
    if (calls.filter((c) => isPromise(c)).length) {
      throw EvalError(
        'The batched method is required for "batch" call. \n' +
          'Try to use rpc.<Model>.<method>.batch(...) instead.'
      );
    }
    const res = (await transport({ route: schema.route, body: calls })) as BatchResponse;
    return res.map((r, i) => {
      if ((r as FailedResponse)?.error) {
        errorCallback((r as FailedResponse).error, calls[i]);
      }
      return (r as Response).result;
    });
  }

  function cache(config: CacheConfig) {
    const { get, set } = cacheStorage(config);
    return function (method: string) {
      return async function (...params: unknown[]) {
        const cached = get({ method, params });

        if (!config?.mode === 'update' && cached) return cached;

        const res = call(method)(params).then((res) => {
          set({ method, params }, res);
          return res;
        });
        return cached ?? res;
      };
    };
  }

  return { call, batch, cache };
}

export function dynamicClient<T>(params?: { endpoint?: string; config?: ClientConfig }): Client<T> {
  let endpoint;
  try {
    endpoint = params?.endpoint ?? window?.location?.href;
  } catch {
    endpoint = '/';
    console.error(`No endpoint provided and window.location is undefined. It set '/' as default`);
  }
  const schema = { route: endpoint } as Schema;

  type Path = { path: string[]; modifiers: string[] } & object;

  const { call, batch, cache } = initClient({ schema, config: params?.config });

  const modifiers = {
    apply: function (target: Path, _: unknown, params: unknown[]) {
      const method = target.path.join('.');
      const [modifier] = target.modifiers;

      if (modifier === 'batch') {
        return buildRequest({ method, params });
      } else if (modifier === 'cache') {
        return cache(params[0] as CacheConfig)(method);
      } else {
        return call(method)(params);
      }
    },

    get: function (target: Path, prop: string): unknown {
      target.modifiers = target.modifiers.concat(prop);
      return new Proxy(
        Object.assign(function () {}, target),
        modifiers
      );
    }
  };

  const method = {
    get: function (target: Path, prop: string): unknown {
      target.path = [target.path[0], prop];
      return new Proxy(
        Object.assign(function () {}, { path: [...target.path], modifiers: [] }),
        modifiers
      );
    }
  };
  const service = {
    get: function (target: Path, prop: string): unknown {
      if (prop === 'batch') return batch;
      return new Proxy({ path: [prop], modifiers: [] }, method);
    }
  };
  return new Proxy({ path: [], modifiers: [] }, service) as unknown as Client<T>;
}
export const client = dynamicClient;
