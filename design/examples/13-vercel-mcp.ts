// 13 · MCP через mcp-handler (бывш. @vercel/mcp-adapter) — спайк моста chord → официальный адаптер.
//
// Файл разделён на три части:
//   [1] КОД ПОЛЬЗОВАТЕЛЯ — createMcpHandler + registerMcpTools(server, composer) + декларация с mcp-метой;
//   [2] ПОД КАПОТОМ — что переиспользуется из chord и что даёт mcp-handler;
//   [3] ДЕМО-КЛИЕНТ И ПРОВЕРКИ — стенд (helpers/mcp-client), не API пакета.
//
// ЗАЧЕМ: mcp-handler v2 нативно реализует ревизию 2026-07-28 (stateless, discover, subscriptions/listen,
// MRTR inputRequired) — ту же, что вручную пишет спайк 06. Решение A (2026-11-23): переиспользовать
// официальный протокол+транспорт, chord = реестр/DI/валидация/генерация.
//
// Шов возврата (решения 2026-11-23): явный MCP-only `mcp.result` (value типизирован из out, возврат
// проверяется против McpToolResult); McpMeta расширена, нейтральная мета fn переиспользуется, mcp приоритетнее.
//
// Compile-check (design/examples/tsconfig.json наследует корневой tsconfig с алиасами @/* → src/*):
//   npx tsc --noEmit -p design/examples/tsconfig.json
// Живой прогон: npx tsx design/examples/13-vercel-mcp.ts

// ═══════════════════════════════════════════════════════════════════════════
// [1] КОД ПОЛЬЗОВАТЕЛЯ — всё
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { createMcpHandler } from 'mcp-handler'; // транспорт/протокол — у пользователя
import { compose } from '../../src';
import { ZodAdapter } from '../../src/schemas/zod';
import { fn, registerMcpTools } from '../../src/mcp/vercel'; // dep-free лист: fn с mcp.result из out + регистрация

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

class Media {
  // image-тул: обработчик чистый доменный (переиспользуется в REST/jsonrpc), MCP-content — пост-обработчиком.
  static $avatar = fn({
    in: z.object({ id: z.string() }),
    out: z.object({ png: z.string(), mime: z.string() }),
    desc: 'Neutral description (OpenRPC)', // нейтральная мета — для OpenRPC
    mcp: {
      title: 'Get avatar',
      desc: 'MCP description wins', // приоритет mcp над нейтральной desc
      annotations: { readOnlyHint: true },
      // value типизирован из out: { png: string; mime: string } — без кастов; возврат проверяется.
      result: (v) => ({ content: [{ type: 'image', data: v.png, mimeType: v.mime }] }),
    },
  });
  avatar: typeof Media.$avatar.fn = async ({ id }) => ({ png: PNG_1x1, mime: 'image/png' });

  // scalar-тул: unified flatToolSchema оборачивает скаляр в { value } (inputSchema object-формы),
  // packToolArgs распаковывает обратно. Тот же единый метод схемы, что и для object-тула.
  static $double = fn({ in: z.number(), out: z.number(), summary: 'Удвоение', mcp: { title: 'Double', desc: 'Умножает на 2' } });
  double: typeof Media.$double.fn = async (n) => n * 2;

  // Без mcp-кармана → НЕ MCP-тул (opt-in): остаётся jsonrpc-эндпоинтом, в tools/list не попадает.
  static $echo = fn({ in: z.string(), out: z.string(), desc: 'Echo text' });
  echo: typeof Media.$echo.fn = async (s) => s;
}

// Прувы строгости (compile-time, решение 2): value типизирован из out, возврат проверяется.
// @ts-expect-error — v: string (из out), v.png не существует (value не any)
fn({ in: z.string(), out: z.string(), mcp: { result: (v) => ({ content: [{ type: 'text', text: v.png }] }) } });
// @ts-expect-error — возврат не-McpToolResult отклоняется (проверка return на выход)
fn({ in: z.string(), out: z.string(), mcp: { result: (v) => ({ wrong: v }) } });

const composer = compose({ Media }, { schemas: new ZodAdapter() });

// Пользователь владеет транспортом: сам зовёт createMcpHandler, chord регистрирует тулы на server.
const handler = createMcpHandler(
  (server) => {
    registerMcpTools(server, composer, { ctx: (req) => ({ user: req.headers.get('x-user') ?? 'anon' }) });
    // Свои тулы — рядом, в том же initialize (отдельный хук не нужен):
    server.registerTool('ping', { description: 'Health check (вне composer)' }, async () => ({
      content: [{ type: 'text' as const, text: 'pong' }],
    }));
  },
  { serverInfo: { name: 'chord-media', version: '2.0.0' }, instructions: 'Media tools over MCP 2026-07-28 via mcp-handler' },
);

// SvelteKit: src/routes/mcp/+server.ts. Next.js: export { handler as GET, handler as POST }.
export const POST = (event: { request: Request }) => handler(event.request);

// ═══════════════════════════════════════════════════════════════════════════
// [2] ПОД КАПОТОМ — пользователь этого не пишет
// ═══════════════════════════════════════════════════════════════════════════
//
// src/mcp-handler (мост, opt-in лист, DEP-FREE — SDK/mcp-handler не импортит):
//   registerMcpTools(server, composer, opts): opt-in (только эндпоинты с mcp-карманом); сервер
//     типизирован структурно (McpServerLike), реальный McpServer пользователя совместим;
//   inputSchema = flatToolSchema(contract, schemas) — ЕДИНЫЙ метод схемы для MCP и tools:
//     StandardSchemaWithJSON (validate + jsonSchema Converter из адаптера), без fromJsonSchema;
//     flatToolJson — общий flat-JSON (mcpTools переиспользует); object — identity, scalar/REST — обёртка;
//   registerTool(name, {title, description, inputSchema, annotations, icons, _meta}, handler):
//     декорация из mcp-меты (приоритет) + нейтральной; handler(args, ctx) → packToolArgs → core.call
//     (DI + валидация) → toCallToolResult(value, mcp): явный mcp.result, иначе default text-обёртка;
//     ctx.http.req → chord ctx фабрикой пользователя.
//
// Типизация: fn (I/O generics) — mcp.result получает value: Out<C>, возврат против McpToolResult
//   (chord-native зеркало CallToolResult, dep-free). core fn не тронут (rest-сахар от fn не зависит).
//
// Транспорт/протокол 2026-07-28 (discover, tools, subscriptions/listen, MRTR, конформанс) — у пользователя
//   через mcp-handler (createMcpHandler); chord = реестр/DI/валидация/генерация. Потребитель ставит
//   mcp-handler сам (peerDependencies листа — только chord-внутренние, внешних нет).

// ═══════════════════════════════════════════════════════════════════════════
// [3] ДЕМО-КЛИЕНТ И ПРОВЕРКИ — не пользовательский код
// ═══════════════════════════════════════════════════════════════════════════

import { mcpDemoClient } from './helpers/mcp-client';

const client = mcpDemoClient((event) => handler(event.request));

(async () => {
  const discover = await client.json('server/discover');
  console.log('13 discover →', JSON.stringify(discover).slice(0, 160));

  // tools/list: mcp-описанные (Media.avatar object, Media.double scalar) + ping; Media.echo без mcp — исключён.
  const list = await client.json('tools/list', {}, { id: 2 });
  console.log('13 tools/list →', (list.result?.tools ?? []).map((t: any) => t.name));

  // tools/call avatar → mcp.result: image-блок (не JSON.stringify).
  const avatar = await client.json('tools/call', { name: 'Media.avatar', arguments: { id: '1' } }, { id: 3 });
  console.log('13 avatar →', JSON.stringify(avatar.result?.content ?? avatar).slice(0, 200));

  // tools/call double (scalar) → unified-схема { value }: аргумент value, возврат default text-обёртка.
  const double = await client.json('tools/call', { name: 'Media.double', arguments: { value: 21 } }, { id: 6 });
  console.log('13 double →', JSON.stringify(double.result?.content ?? double).slice(0, 120));

  // tools/call ping → пользовательский тул из хука server.
  const ping = await client.json('tools/call', { name: 'ping', arguments: {} }, { id: 4 });
  console.log('13 ping →', JSON.stringify(ping.result?.content ?? ping).slice(0, 120));

  // Media.echo без mcp → не тул: tools/call даёт ошибку (метод не найден).
  const echo = await client.json('tools/call', { name: 'Media.echo', arguments: { value: 'hi' } }, { id: 5 });
  console.log('13 echo (не тул) →', JSON.stringify(echo.error ?? echo.result).slice(0, 120));
})();