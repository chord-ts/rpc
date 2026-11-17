// Generation layer (ROADMAP п.6). Generators are transitive to the protocol: rest declarations →
// OpenAPI; fn declarations → OpenRPC + MCP tools/list; stream metadata → AsyncAPI. One registry
// (core.endpoints()), neutral fields (desc/summary/tags/deprecated) shared. Imports types + schemas
// (default adapter fallback); does NOT import protocol/transport — reusable standalone (CLI/export).

import type { AnySchema, RestMeta } from '../types';
import type { Core } from '../core/types';
import { defaultSchemas } from '../schemas';

export interface GenOptions {
  jsonSchema?: (s: AnySchema) => unknown;
  info?: { title: string; version: string; description?: string };
}

/** Schema converter: from the adapter registered in compose (core.schemas), falling back to the
 * generic default; opts.jsonSchema is a point override. $schema is stripped when embedding. */
function converter(opts: GenOptions, core: Core<any>): (s: AnySchema) => unknown {
  const toJson = opts.jsonSchema ?? core.schemas?.jsonSchema ?? defaultSchemas.jsonSchema;
  return (s) => {
    const out = toJson(s);
    if (out && typeof out === 'object' && '$schema' in out) {
      const { $schema: _drop, ...rest } = out as Record<string, unknown>;
      return rest;
    }
    return out;
  };
}

const infoOf = (opts: GenOptions) => opts.info ?? { title: 'Chord RPC', version: '1.0.0' };

const REASON: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  409: 'Conflict', 422: 'Unprocessable Entity', 500: 'Internal Server Error',
};
const reasonPhrase = (status: number) => REASON[status] ?? 'Response';

type JsonObj = { properties?: Record<string, unknown>; required?: string[] };

// --- stream metadata hypothesis (AsyncAPI needs an event-schema source) ---
// stream gasket not designed yet; `stream` field on fn is a proposal: channel + event schema = out.
export interface StreamMeta {
  channel: string;
}

// --- OpenAPI 3.1 (rendered by Swagger UI; 3.1 = native JSON Schema 2020-12) ---
// Transitive to REST: only endpoints with rest metadata. Parts map directly:
// path → parameters in:path (no schema → {type:string}, names from template),
// query → parameters in:query, body → requestBody. Nothing guessed.
export function openapi(core: Core<any>, opts: GenOptions = {}): object {
  const toJson = converter(opts, core);
  const paths: Record<string, Record<string, unknown>> = {};

  for (const e of core.endpoints()) {
    const meta = e.contract?.rest as RestMeta | undefined;
    if (!meta || !e.contract) continue;
    const c = e.contract as Record<string, unknown> & { in: AnySchema; resp?: Record<number, AnySchema> };

    const pathSchema = c.path ? (toJson(c.path as AnySchema) as JsonObj) : undefined;
    const querySchema = c.query ? (toJson(c.query as AnySchema) as JsonObj) : undefined;
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

    // responses from the resp map (FastAPI responses): status → schema.
    const responses: Record<string, unknown> = {};
    for (const [status, schema] of Object.entries(c.resp ?? {})) {
      responses[status] = {
        description: reasonPhrase(+status),
        content: { 'application/json': { schema: toJson(schema) } },
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
      tags: c.tags,
      deprecated: c.deprecated,
      parameters,
      responses,
    };
    if (c.body) {
      operation.requestBody = { required: true, content: { 'application/json': { schema: toJson(c.body as AnySchema) } } };
    }

    paths[meta.endpoint] = { ...paths[meta.endpoint], [meta.method.toLowerCase()]: operation };
  }

  return { openapi: '3.1.0', info: infoOf(opts), paths };
}

// --- OpenRPC 1.3 (method-centric JSON-RPC) ---
// Transitive to JSON-RPC: fn declarations (no rest). params is a single 'params' descriptor
// (our call takes one value, not a positional array).
export function openrpc(core: Core<any>, opts: GenOptions = {}): object {
  const toJson = converter(opts, core);
  const methods = core
    .endpoints()
    .filter((e) => !e.contract?.rest)
    .map((e) => {
      const c = (e.contract ?? {}) as Record<string, unknown>;
      return {
        name: `${e.service}.${e.method}`,
        summary: c.summary,
        description: c.desc,
        tags: c.tags ? (c.tags as string[]).map((name) => ({ name })) : undefined,
        params: e.contract ? [{ name: 'params', required: true, schema: toJson(e.contract.in) }] : [],
        result: { name: 'result', schema: e.contract?.out ? toJson(e.contract.out) : {} },
        errors: [
          { code: -32601, message: 'Method not found' },
          { code: -32602, message: 'Invalid params' },
          { code: -32603, message: 'Internal error' },
        ],
      };
    });
  return { openrpc: '1.3.2', info: infoOf(opts), methods };
}

// --- MCP tools/list ---
// Tools for ALL endpoints with a schema (agent needs REST and fn). REST: path/query/body parts
// flattened into one inputSchema; annotations derived from the HTTP verb. fn: scalar in wrapped
// into { value: … } (MCP requires inputSchema.type === 'object').
type JsonSchemaObj = { type?: string; properties?: Record<string, unknown>; required?: string[] };

const READ_ONLY = ['GET', 'HEAD', 'OPTIONS'];
function hintsFor(method: string): Record<string, boolean> {
  return {
    readOnlyHint: READ_ONLY.includes(method),
    destructiveHint: method === 'DELETE',
    idempotentHint: method === 'PUT' || method === 'DELETE',
  };
}

export function mcpTools(core: Core<any>, opts: GenOptions = {}): { tools: unknown[] } {
  const toJson = converter(opts, core);
  const tools = core
    .endpoints()
    .filter((e) => e.contract)
    .map((e) => {
      const c = e.contract!;
      const meta = c.mcp as { desc?: string; title?: string } | undefined;
      const rest = c.rest as RestMeta | undefined;

      let inputSchema: JsonSchemaObj;
      let outputSchema: unknown;
      if (rest) {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const part of ['path', 'query', 'body'] as const) {
          const s = c[part] ? (toJson(c[part] as AnySchema) as JsonSchemaObj) : undefined;
          Object.assign(properties, s?.properties ?? {});
          required.push(...(s?.required ?? []));
        }
        for (const m of rest.endpoint.matchAll(/\{([^}]+)\}/g)) {
          if (!(m[1] in properties)) {
            properties[m[1]] = { type: 'string' };
            required.push(m[1]);
          }
        }
        inputSchema = { type: 'object', properties, required };
        const success = c.resp ? (c.resp as Record<number, AnySchema>)[rest.status ?? 200] : undefined;
        outputSchema = success ? toJson(success) : undefined;
      } else {
        inputSchema = toJson(c.in) as JsonSchemaObj;
        if (inputSchema.type !== 'object') {
          inputSchema = { type: 'object', properties: { value: inputSchema }, required: ['value'] };
        }
        outputSchema = c.out ? toJson(c.out) : undefined;
      }

      return {
        name: `${e.service}.${e.method}`,
        title: meta?.title,
        description: meta?.desc ?? (c.desc as string) ?? '',
        inputSchema,
        outputSchema,
        annotations: rest ? hintsFor(rest.method) : undefined,
      };
    });
  return { tools };
}

// --- AsyncAPI 3.0 (hypothesis: depends on stream design) ---
// A channel per endpoint with stream metadata; send = params (in), receive = event (out).
export function asyncapi(core: Core<any>, opts: GenOptions = {}): object {
  const toJson = converter(opts, core);
  const channels: Record<string, unknown> = {};
  const operations: Record<string, unknown> = {};

  for (const e of core.endpoints()) {
    const meta = e.contract?.stream as StreamMeta | undefined;
    if (!meta || !e.contract) continue;
    const ch = meta.channel;
    channels[ch] = {
      address: ch,
      messages: {
        params: { payload: toJson(e.contract.in) },
        event: { payload: e.contract.out ? toJson(e.contract.out) : {} },
      },
    };
    operations[`${ch}.send`] = {
      action: 'send',
      channel: { $ref: `#/channels/${ch}` },
      messages: [{ $ref: `#/channels/${ch}/messages/params` }],
    };
    operations[`${ch}.receive`] = {
      action: 'receive',
      channel: { $ref: `#/channels/${ch}` },
      messages: [{ $ref: `#/channels/${ch}/messages/event` }],
    };
  }

  return { asyncapi: '3.0.0', info: infoOf(opts), channels, operations };
}