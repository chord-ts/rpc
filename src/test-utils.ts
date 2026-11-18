// Test helper: adapts the jsonrpc binding to an exec-like call signature, so envelope tests
// keep their assertions while exercising the layered API (compose + jsonrpc), not legacy toRPC.
import { compose } from './core';
import { jsonrpc } from './protocol';
import type { ComposeOptions, ServiceMap } from './core/types';

export function envelope<S extends ServiceMap>(services: S, options: ComposeOptions<S>) {
  const binding = jsonrpc(compose(services, options)).http;
  return async (body: unknown): Promise<any> => {
    // value-level шов: тело — значение, ответ binding'а — значение (без raw-конверта).
    const res = await binding.handle({ method: 'POST', url: 'http://localhost/rpc', body });
    return res.body == null ? undefined : res.body;
  };
}