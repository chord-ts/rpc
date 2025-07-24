import * as spec from '../specs';

import type { Transport, Cache, ErrorCallback } from './types';

export const defaultTransport: Transport = async <T, K>(
  { route, body }: { route: string; body: T },
  opt?: object
): Promise<K> => {
  return await fetch(route, {
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    body: JSON.stringify(body),
    ...(opt as object)
  })
    .then((r) => r.json())
    .catch(() => {
      return { error: { message: 'Failed durning fetch request' } } as spec.FailedResponse;
    });
};

export const defaultCache: Cache.Storage = (config) => {
  const storageKey = '__chord_cache__';
  const expiry = config?.expiry ?? 1000 * 60 * 5; // 5 min by default
  const onInvalidate = config?.onInvalidate ?? (() => {});

  function call2Key(method: string, params: unknown) {
    return `${method}(${JSON.stringify(params)})`;
  }
  const get: Cache.Getter = ({ method, params }) => {
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

  const set: Cache.Setter = ({ method, params }, result) => {
    if (typeof localStorage === 'undefined') return null;
    const store = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    const callKey = call2Key(method, params);
    store[callKey] = { result, time: new Date() };
    onInvalidate(result);

    localStorage.setItem(storageKey, JSON.stringify(store));
  };

  return { get, set };
};

class RPCError extends Error {
  data: unknown;
  code: number;
  name = 'RPC Error';
  constructor({ data, code, message }: spec.Error) {
    super(message);
    this.data = data;
    this.code = code;
  }
}
export const defaultOnError: ErrorCallback = async (e, { method, params }) => {
  if (!Array.isArray(params)) params = [params];
  console.error(
    `Error occurred during RPC Call: ${method}(${params.map((p) => JSON.stringify(p)).join(',')})`
  );

  throw new RPCError(e);
};
