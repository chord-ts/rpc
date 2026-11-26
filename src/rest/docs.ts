// OpenAPI 3.1 + Swagger UI / ReDoc — генераторы REST-протокола (co-location). Транзитивны rest:
// только эндпоинты с rest-метой. Части → parameters in:path/in:query, body → requestBody. Импортят generate/core.

import type { AnySchema, RestMeta, HttpProtocol } from '@/types';
import type { Core } from '@/core/types';
import { converter, infoOf, reasonPhrase, serveSpec, serveHtml, inlineJson, type GenOptions, type Spec, type JsonObj } from '@/generate/core';

export function openapi(core: Core<any>, opts: GenOptions = {}): Spec {
  const toJson = converter(opts, core);
  const paths: Record<string, Record<string, unknown>> = {};

  for (const e of core.endpoints()) {
    const meta = e.contract?.rest as RestMeta | undefined;
    if (!meta || !e.contract) continue;
    const c = e.contract as Record<string, unknown> & { in: AnySchema; resp?: Record<number, AnySchema> };

    const pathSchema = c.path ? (toJson(c.path as AnySchema, 'input') as JsonObj) : undefined;
    const querySchema = c.query ? (toJson(c.query as AnySchema, 'input') as JsonObj) : undefined;
    const pathNames = [...meta.endpoint.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

    const parameters: unknown[] = [];
    for (const name of pathNames) {
      parameters.push({
        name,
        in: 'path',
        required: true,
        schema: pathSchema?.properties?.[name] ?? { type: 'string' },
      });
    }
    for (const [name, schema] of Object.entries(querySchema?.properties ?? {})) {
      parameters.push({ name, in: 'query', required: (querySchema?.required ?? []).includes(name), schema });
    }

    // responses из resp-карты (FastAPI responses): status → schema.
    const responses: Record<string, unknown> = {};
    for (const [status, schema] of Object.entries(c.resp ?? {})) {
      responses[status] = {
        description: reasonPhrase(+status),
        content: { 'application/json': { schema: toJson(schema, 'output') } },
      };
    }
    responses.default = {
      description: 'Error',
      content: { 'application/json': { schema: { type: 'object', properties: { detail: { type: 'string' } } } } },
    };

    const operation: Record<string, unknown> = {
      operationId: `${e.service}.${e.method}`,
      summary: c.summary,
      description: c.desc,
      tags: c.tags ?? [e.service], // дефолт-тег = имя класса: группировка в swagger/clef
      deprecated: c.deprecated,
      parameters,
      responses,
    };
    if (c.body) {
      operation.requestBody = { required: true, content: { 'application/json': { schema: toJson(c.body as AnySchema, 'input') } } };
    }

    paths[meta.endpoint] = { ...paths[meta.endpoint], [meta.method.toLowerCase()]: operation };
  }

  return serveSpec({ openapi: '3.1.0', info: infoOf(opts), paths });
}

// Swagger UI / ReDoc: UI-binding поверх OpenAPI (inline spec). Пользователь монтирует на свой GET.
export function swagger(core: Core<any>, opts: GenOptions = {}): HttpProtocol {
  const document = openapi(core, opts).document;
  return serveHtml(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>` +
      `<body><div id="swagger-ui"></div>` +
      `<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>` +
      `<script>SwaggerUIBundle({ spec: ${inlineJson(document)}, dom_id: '#swagger-ui' })</script>` +
      `</body></html>`,
  );
}

export function redoc(core: Core<any>, opts: GenOptions = {}): HttpProtocol {
  const document = openapi(core, opts).document;
  return serveHtml(
    `<!doctype html><html><head><meta charset="utf-8"></head>` +
      `<body><div id="redoc"></div>` +
      `<script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>` +
      `<script>Redoc.init(${inlineJson(document)}, {}, document.getElementById('redoc'))</script>` +
      `</body></html>`,
  );
}