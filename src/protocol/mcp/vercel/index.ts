// MCP-мост chord → mcp-handler (бывш. @vercel/mcp-adapter) — OPT-IN лист, БЕЗ внешних зависимостей.
// Пользователь сам зовёт createMcpHandler (mcp-handler) и передаёт нам server; chord регистрирует
// на нём тулы composer'а. Транспорт/протокол ревизии 2026-07-28 владеет пользователь (mcp-handler),
// chord — реестр/DI/валидация/генерация. SDK не импортится: сервер типизирован структурно.
//
// Форма (согласована 2026-11-23):
//   - registerMcpTools(server, composer, opts): opt-in, тулами становятся только эндпоинты с mcp-карманом;
//   - inputSchema — flat-схема с jsonSchema Converter из адаптера (withJsonSchema), передаётся напрямую
//     в registerTool без fromJsonSchema; schema-agnostic (JSON даёт адаптер, не вендор);
//   - явный MCP-only пост-обработчик mcp.result (value типизирован из out, возврат — против McpToolResult);
//   - декорация mcp-меты приоритетнее нейтральной; свои тулы пользователь регистрирует рядом (в своём initialize).

import { fn as coreFn } from '@/core';
import { mcpTools } from '@/generate';
import { flatToolSchema, packToolArgs, resolveSchemas } from '@/schemas';
import type { AnySchema, McpMeta as McpMetaBase, McpAnnotations } from '@/types';
import type { Contract, Out, Fn, Core } from '@/core/types';

export type { McpAnnotations, McpMetaBase };

// --- Возврат тула: chord-native зеркало SDK CallToolResult (dep-free форма для проверки декларации) ---

export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; text?: string; blob?: string; mimeType?: string } }
  | { type: 'resource_link'; uri: string; name?: string; title?: string; mimeType?: string };

export type McpToolResult = {
  content: McpContentBlock[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

/** MCP-мета с пост-обработчиком: декорация (из types) + result, типизированный из out. */
export type McpMeta<O = unknown> = McpMetaBase & {
  /** MCP-only пост-обработчик: доменный возврат (тип из out) → content-блоки. Без него — default wrap. */
  result?: (value: O) => McpToolResult;
};

/** Типизированная fn для MCP-деклараций: mcp.result получает value: Out<C> (I/O generics — условный
 * Out<C> внутри `C & {...}` схлопывает C при выводе). Runtime — тот же core fn. */
export function fn<I extends AnySchema<any>, O extends AnySchema<any> | undefined = undefined>(
  c: { in: I; out?: O; desc?: string; mcp?: McpMeta<Out<{ in: I; out: O }>>; [k: string]: unknown },
): Fn<{ in: I; out: O }> {
  return coreFn(c as Contract) as unknown as Fn<{ in: I; out: O }>;
}

/** Явный mcp.result приоритетнее; иначе default-обёртка в text-блок (без эвристики passthrough). */
export function toCallToolResult(value: unknown, meta: McpMeta | undefined): McpToolResult {
  if (meta?.result) return meta.result(value);
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] };
}

/** Структурный минимум McpServer (SDK не импортится). Реальный McpServer пользователя совместим. */
export interface McpServerLike {
  registerTool(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: unknown;
      annotations?: unknown;
      icons?: unknown;
      _meta?: Record<string, unknown>;
    },
    // any: структурный адаптер-интерфейс — реальный McpServer (SDK) совместим без импортa SDK-типов.
    handler: (args: any, ctx: { http?: { req?: Request } }) => any,
  ): unknown;
}

export interface RegisterMcpOptions {
  /** Per-request DI ctx из сырого HTTP-запроса (обработчик тула получает ctx.http.req). */
  ctx?: (req: Request) => unknown;
  jsonSchema?: (s: AnySchema) => unknown;
}

type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
};

/** Регистрирует MCP-тулы composer'а на сервере пользователя (opt-in: только эндпоинты с mcp-карманом).
 * Вызывается внутри createMcpHandler((server) => …); свои тулы пользователь регистрирует рядом. */
export function registerMcpTools(server: McpServerLike, core: Core<any>, opts: RegisterMcpOptions = {}) {
  const schemas = resolveSchemas(core, opts.jsonSchema);
  const toJson = (s: AnySchema) => schemas.jsonSchema(s);
  const mcpCore: Core<any> = { ...core, endpoints: () => core.endpoints().filter((e) => e.contract?.mcp) };
  const tools = mcpTools(mcpCore, { jsonSchema: opts.jsonSchema }).document.tools as McpTool[];
  const endpoints = new Map(mcpCore.endpoints().map((e) => [`${e.service}.${e.method}`, e]));

  for (const tool of tools) {
    const ep = endpoints.get(tool.name);
    if (!ep?.contract) continue;
    const contract = ep.contract;
    const meta = (contract as { mcp?: McpMeta }).mcp;
    // Единый метод схемы (validate + jsonSchema Converter) — registerTool принимает напрямую.
    const inputSchema = flatToolSchema(contract, schemas);
    server.registerTool(
      tool.name,
      {
        title: meta?.title ?? tool.title,
        description: tool.description,
        inputSchema,
        annotations: meta?.annotations ?? tool.annotations,
        icons: meta?.icons,
        _meta: meta?._meta,
      },
      async (args, ctx) => {
        const req = ctx.http?.req;
        const chordCtx = opts.ctx && req ? opts.ctx(req) : {};
        const params = packToolArgs(contract, args, toJson);
        const value = await core.call(tool.name, params, { ctx: chordCtx });
        return toCallToolResult(value, meta);
      },
    );
  }
}