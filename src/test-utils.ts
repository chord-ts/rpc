// Test helper: adapts the jsonrpc binding to an exec-like call signature, so envelope tests
// keep their assertions while exercising the layered API (compose + jsonrpc), not legacy toRPC.
import { compose } from './core';
import { jsonrpc } from './jsonrpc';
import type { ComposeOptions, ServiceMap } from './core/types';

export function envelope<S extends ServiceMap>(services: S, options: ComposeOptions<S>) {
  const binding = jsonrpc(compose(services, options)).http;
  return async (body: unknown): Promise<any> => {
    // exec-like helper builds a conformant envelope: adds jsonrpc:'2.0' to request objects that
    // omit it (the binding itself validates the version strictly — see jsonrpc conformance tests).
    const withVersion = (item: unknown) =>
      item !== null && typeof item === 'object' && !Array.isArray(item) ? { jsonrpc: '2.0', ...(item as object) } : item;
    const normalized = Array.isArray(body) ? body.map(withVersion) : withVersion(body);
    // value-level шов: тело — значение, ответ binding'а — значение (без raw-конверта).
    const res = await binding.handle({ method: 'POST', url: 'http://localhost/rpc', body: normalized });
    return res.body == null ? undefined : res.body;
  };
}