import * as spec from '../specs';

import type {
  Transport,
  Cache,
  ErrorCallback,
  Format,
} from './types'



export const defaultTransport: Transport = async<T, K>({ route, body, format }: { route: string, body: T, format: Format }, opt?: object): Promise<K> => {
  let res: Response;
  try {
    res = await fetch(route, {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST', body: format.stringify(body), ...(opt as object)
    });
  } catch (e) {
    // Сетевой сбой (до ответа): нативная ошибка fetch.
    return { error: { code: spec.ErrorCode.ServerError, message: e instanceof Error ? e.message : String(e), data: e } } as spec.FailedResponse as K;
  }

  // Редирект: переходим на финальный URL. fetch следует редиректу сам (follow), res.redirected/res.url
  // дают цель; в браузере переход через location.assign, в Node (SSR) location нет — отдаём ошибкой.
  if (res.redirected || (res.status >= 300 && res.status < 400)) {
    if (typeof location !== 'undefined' && typeof location.assign === 'function') location.assign(res.url);
    return { error: { code: res.status, message: `Redirected to ${res.url}`, data: { status: res.status, location: res.url, redirected: true } } } as spec.FailedResponse as K;
  }

  // HTTP-ошибка (500 и др.): не парсим JSON — это страница ошибки, не JSON-RPC ответ. Сырое тело,
  // в лог — заголовки и trim-предпросмотр (без тегов, усечённый), упаковка в ошибку со статусом.
  if (!res.ok) {
    const text = await res.text();
    const headers = Object.fromEntries(res.headers.entries());
    const preview = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    // set-cookie/authorization не пишем в лог (SSR-утечка сессии); в error.data они остаются.
    const safeHeaders = Object.fromEntries(
      Object.entries(headers).filter(([k]) => !['set-cookie', 'authorization'].includes(k.toLowerCase())),
    );
    console.error(`[chord] HTTP ${res.status} ${res.statusText} from ${route}\nheaders: ${JSON.stringify(safeHeaders)}\npreview: ${preview}`);
    return { error: { code: res.status, message: res.statusText || `HTTP ${res.status}`, data: { status: res.status, headers, body: text } } } as spec.FailedResponse as K;
  }

  // Успех: JSON-RPC ответ (в т.ч. error в теле с HTTP 200).
  try {
    return await format.parse(res) as K;
  } catch (e) {
    return { error: { code: spec.ErrorCode.ParseError, message: 'Invalid JSON response', data: { status: res.status, cause: e instanceof Error ? e.message : String(e) } } } as spec.FailedResponse as K;
  }
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
  data: unknown
  code: number
  name: string
  reason?: string

  constructor({name, data, code, message, reason}: spec.Error) {
    super(message)
    this.name = name ?? 'RPC Error'
    this.data = data
    this.code = code
    this.reason = reason
  }
}
export const defaultOnError: ErrorCallback = async (e, { method, params }) => {
  if (!Array.isArray(params)) params = [params];
  console.error(
    `Error occurred during RPC Call: ${method}(${params.map((p) => {
      try {
        return JSON.stringify(p)
        // Handle if BigInt or something else
      } catch(e) {
        return p
      }
    }).join(',')})`
  );

  // @ts-ignore
  throw new RPCError(e)
};
