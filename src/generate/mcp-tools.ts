// MCP tools/list — генератор MCP-тулов. Реализация в generate-слое (ниже tools и protocol):
// agentTools (tools) и mcp-handler (protocol/mcp) оба потребляют mcpTools. protocol/mcp/tools.ts
// реэкспортит для co-location. Tools для всех unary-эндпоинтов со схемой (REST + fn; stream — не тул).

import type { AnySchema, McpMeta, RestMeta } from '../types';
import type { Core } from '../core/types';
import { flatToolJson } from '../schemas';
import { converter, serveSpec, type GenOptions, type Spec } from './core';

type JsonSchemaObj = { type?: string; properties?: Record<string, unknown>; required?: string[] };

const READ_ONLY = ['GET', 'HEAD', 'OPTIONS'];
function hintsFor(method: string): Record<string, boolean> {
  const readOnly = READ_ONLY.includes(method);
  return {
    readOnlyHint: readOnly,
    // Spec default destructiveHint is true: POST/PATCH/PUT/DELETE may modify state. Only the
    // safe verbs are non-destructive (the old code marked every POST/PATCH destructive:false).
    destructiveHint: !readOnly,
    idempotentHint: readOnly || method === 'PUT' || method === 'DELETE',
  };
}

export function mcpTools(core: Core<any>, opts: GenOptions = {}): Spec<{ tools: unknown[] }> {
  const toJson = converter(opts, core);
  const tools = core
    .endpoints()
    .filter((e) => e.contract && !e.contract.event)
    .map((e) => {
      const c = e.contract!;
      const meta = c.mcp as McpMeta | undefined;
      const rest = c.rest as RestMeta | undefined;

      // Плоский inputSchema — общий метод с flatToolSchema (MCP/tools), без дублирования.
      const inputSchema = flatToolJson(c, (s) => toJson(s, 'input')) as JsonSchemaObj;
      let outputSchema: unknown;
      if (rest) {
        const success = c.resp ? (c.resp as Record<number, AnySchema>)[rest.status ?? 200] : undefined;
        outputSchema = success ? toJson(success, 'output') : undefined;
      } else {
        outputSchema = c.out ? toJson(c.out, 'output') : undefined;
      }

      return {
        // mcp.name задаёт плоское имя тула (MCP-провод); иначе Service_method. Подчёркивание, не
        // точка: OpenAI/Anthropic function-calling отвергают имена с точкой.
        name: meta?.name ?? `${e.service}_${e.method}`,
        title: meta?.title,
        description: meta?.desc ?? (c.desc as string) ?? '',
        inputSchema,
        // MCP outputSchema MUST be an object schema; a scalar/array result is omitted (the tool
        // still returns text content). Advertising {"type":"string"} is invalid per spec.
        outputSchema: (outputSchema as { type?: string } | undefined)?.type === 'object' ? outputSchema : undefined,
        // User-declared mcp.annotations win; REST verbs fall back to spec hints.
        annotations: meta?.annotations ?? (rest ? hintsFor(rest.method) : undefined),
      };
    });
  return serveSpec({ tools });
}