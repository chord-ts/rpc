// MCP tools/list — генератор MCP-тулов. Реализация в generate-слое (ниже tools и protocol):
// agentTools (tools) и mcp-handler (protocol/mcp) оба потребляют mcpTools. protocol/mcp/tools.ts
// реэкспортит для co-location. Tools для всех unary-эндпоинтов со схемой (REST + fn; stream — не тул).

import type { AnySchema, RestMeta } from '../types';
import type { Core } from '../core/types';
import { flatToolJson } from '../schemas';
import { converter, serveSpec, type GenOptions, type Spec } from './core';

type JsonSchemaObj = { type?: string; properties?: Record<string, unknown>; required?: string[] };

const READ_ONLY = ['GET', 'HEAD', 'OPTIONS'];
function hintsFor(method: string): Record<string, boolean> {
  return {
    readOnlyHint: READ_ONLY.includes(method),
    destructiveHint: method === 'DELETE',
    idempotentHint: method === 'PUT' || method === 'DELETE',
  };
}

export function mcpTools(core: Core<any>, opts: GenOptions = {}): Spec<{ tools: unknown[] }> {
  const toJson = converter(opts, core);
  const tools = core
    .endpoints()
    .filter((e) => e.contract && !e.contract.event)
    .map((e) => {
      const c = e.contract!;
      const meta = c.mcp as { desc?: string; title?: string } | undefined;
      const rest = c.rest as RestMeta | undefined;

      // Плоский inputSchema — общий метод с flatToolSchema (MCP/tools), без дублирования.
      const inputSchema = flatToolJson(c, toJson) as JsonSchemaObj;
      let outputSchema: unknown;
      if (rest) {
        const success = c.resp ? (c.resp as Record<number, AnySchema>)[rest.status ?? 200] : undefined;
        outputSchema = success ? toJson(success) : undefined;
      } else {
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
  return serveSpec({ tools });
}