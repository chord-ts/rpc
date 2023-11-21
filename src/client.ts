import type { Schema, ClientConfig, Transport, ErrorCallback, Client } from './types';

import type { FailedResponse, Response, BatchRequest, BatchResponse } from './specs';
import { buildRequest } from './specs';

const defaultTransport: Transport = async ({ route, body }) => {
  // TODO Catch if request failed
  return await fetch(route, { method: 'POST', body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => {
      return { error: { message: 'Failed durning fetch request' } } as FailedResponse;
    });
};

const defaultErrorCallback: ErrorCallback = async (e, { method, params }) => {
  console.error(`Error occurred during RPC Call: ${method}(${params})`);
  throw new EvalError(e.message);
};

// https://bobbyhadz.com/blog/javascript-check-if-value-is-promise
function isPromise(p: unknown | Promise<unknown>) {
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

export function initClient<T>(schema: Schema, config?: ClientConfig): Client<T> {
  const transport = config?.transport ?? defaultTransport;
  const errorCallback = config?.onError ?? defaultErrorCallback;

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
      throw TypeError(
        'You have passed a Callable method that is Promise, ' +
          'but Batched Callable is required for "batch" call. \n' +
          'Try to use rpc.b.<Model>.<method> instead.'
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

  const handler: Record<string, unknown> = {
    batch
  };

  for (const model of schema.models) {
    const modelMethods = Object.entries(schema.methods).filter(([k]) => k.split('.')[0] === model);

    const instance: Record<string, unknown> = {};

    for (const [method] of modelMethods) {
      const methodName = method.split('.')[1] as string;
      const callable = new Proxy(call(method), {
        apply: function (target, thisArg, args) {
          return target(args);
        },
        get: function () {
          return (...params: unknown[]) => buildRequest({ method, params });
        }
      });
      instance[methodName] = callable; // Isolated by models methods
      handler[methodName] = callable; // Make available top level methods
    }
    handler[model] = instance;
  }
  return handler as unknown as Client<T>;
}
