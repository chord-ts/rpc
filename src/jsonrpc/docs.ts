// OpenRPC 1.3 + clef — генераторы JSON-RPC-протокола (co-location). Транзитивны jsonrpc:
// unary fn-декларации (no rest, no stream — stream описывает AsyncAPI). Импортят generate/core.

import type { AnySchema, HttpProtocol } from '@/types';
import type { Core } from '@/core/types';
import { converter, hoistSchemaDefs, infoOf, serveSpec, serveHtml, inlineJson, type GenOptions, type Spec, type JsonObj } from '@/generate/core';

type TupleObj = JsonObj & { type?: string; prefixItems?: unknown[]; minItems?: number };

// params из input-схемы: object → дескриптор на каждое property (by-name); tuple (prefixItems) →
// позиционный дескриптор на элемент (by-position, имена arg0/arg1, required по minItems); скаляр и
// обычный массив → один позиционный arg0 (провод [value]/[[…]]); пустая схема (void/any) → params нет.
function paramsOf(schema: unknown): unknown[] {
  const s = (schema ?? {}) as TupleObj;
  if (s.type === 'object') {
    return Object.entries(s.properties ?? {}).map(([name, prop]) => ({
      name,
      required: (s.required ?? []).includes(name),
      schema: prop,
    }));
  }
  if (s.type === 'array' && s.prefixItems) {
    const min = s.minItems ?? s.prefixItems.length;
    return s.prefixItems.map((item, i) => ({ name: `arg${i}`, required: i < min, schema: item }));
  }
  if (Object.keys(s).length === 0) return [];
  return [{ name: 'arg0', required: true, schema }];
}

// paramStructure (OpenRPC): object → by-name, скаляр/tuple/массив → by-position; void → 'either'.
function structureOf(s: TupleObj | undefined): 'by-name' | 'by-position' | undefined {
  if (!s || Object.keys(s).length === 0) return undefined;
  return s.type === 'object' ? 'by-name' : 'by-position';
}

export function openrpc(core: Core<any>, opts: GenOptions = {}): Spec {
  const toJson = converter(opts, core);
  // Recursive/reused schemas carry local $defs; hoist them to components.schemas so embedded
  // params/result refs resolve against the document root (OpenRPC requires a valid meta-schema doc).
  const schemas: Record<string, unknown> = {};
  let sid = 0;
  const methods = core
    .endpoints()
    .filter((e) => !e.contract?.rest && !e.contract?.event)
    .map((e) => {
      const c = (e.contract ?? {}) as Record<string, unknown>;
      const inJson = e.contract
        ? (hoistSchemaDefs(toJson(e.contract.in, 'input'), schemas, `in${sid++}`) as TupleObj)
        : undefined;
      const outJson = e.contract?.out ? hoistSchemaDefs(toJson(e.contract.out, 'output'), schemas, `out${sid++}`) : {};
      return {
        name: `${e.service}.${e.method}`,
        summary: c.summary,
        description: c.desc,
        deprecated: c.deprecated ?? false,
        tags: (c.tags ? (c.tags as string[]) : [e.service]).map((name) => ({ name })),
        params: inJson ? paramsOf(inJson) : [],
        paramStructure: structureOf(inJson),
        result: { name: 'result', schema: outJson },
        errors: [
          { code: -32601, message: 'Method not found' },
          { code: -32602, message: 'Invalid params' },
          { code: -32603, message: 'Internal error' },
        ],
      };
    });
  const document = {
    openrpc: '1.3.2',
    info: infoOf(opts),
    methods,
    ...(Object.keys(schemas).length ? { components: { schemas } } : {}),
  };
  return serveSpec(document);
}

// clef: UI-binding поверх OpenRPC (inline spec) — explorer + Try it. endpoint — адрес JSON-RPC-binding'а.
export function clef(
  core: Core<any>,
  opts: GenOptions & { endpoint?: string; transports?: ('http' | 'websocket')[] } = {},
): HttpProtocol {
  const document = openrpc(core, opts).document;
  const mount = { spec: document, endpoint: opts.endpoint, transports: opts.transports };
  return serveHtml(
    `<!doctype html><html><head><meta charset="utf-8"></head>` +
      `<body style="margin:0"><div id="clef" style="height:100vh"></div>` +
      `<script src="https://cdn.jsdelivr.net/npm/@chord-ts/clef"></script>` +
      `<script>clef.mount('#clef', ${inlineJson(mount)})</script>` +
      `</body></html>`,
  );
}