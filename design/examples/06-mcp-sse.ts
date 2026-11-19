// 06 · MCP Streamable HTTP, ревизия 2026-07-28 (продвинутый, спайк).
//
// Файл разделён на три части:
//   [1] КОД ПОЛЬЗОВАТЕЛЯ — только обёртка: одна фабрика + generic-адаптер;
//   [2] ПОД КАПОТОМ — что скрыто и какая дельта нужна в src;
//   [3] ДЕМО-КЛИЕНТ И ПРОВЕРКИ — стенд вместо настоящего MCP-клиента, не API.
//
// Ревизия сделала MCP stateless: сессий, GET-эндпоинта и initialize больше НЕТ. Один POST;
// ответ — json или SSE-поток на запрос. Долгоживущие уведомления — subscriptions/listen,
// чей ответ и есть поток. Src не тронут (legacy mcp() рядом обслуживает примеры 03/09).
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/06-mcp-sse.ts

// ═══════════════════════════════════════════════════════════════════════════
// [1] КОД ПОЛЬЗОВАТЕЛЯ — всё
// ═══════════════════════════════════════════════════════════════════════════

import { compose } from '../../src';
import { ZodAdapter } from '../../src/schemas/zod';
import { Math } from './shared';
import { mcp } from './helpers/mcp';
import { fromSvelteKit } from './helpers/http';

const composer = compose({ Math }, { schemas: new ZodAdapter() });
const mcpEndpoint = mcp(composer, {
  info: { name: 'chord-math', version: '2.0.0' },
  instructions: 'Math tools over MCP 2026-07-28',
  resources: true,
});

// SvelteKit: src/routes/mcp/+server.ts — один обработчик, generic-адаптер.
export const POST = fromSvelteKit(mcpEndpoint);

// Когда в домене что-то изменилось — одна строка, без генераторов и signal:
//   mcpEndpoint.publish({ kind: 'tools-changed' });
//   mcpEndpoint.publish({ kind: 'resource-updated', uri });

// ═══════════════════════════════════════════════════════════════════════════
// [2] ПОД КАПОТОМ — пользователь этого не пишет и не импортирует
// ═══════════════════════════════════════════════════════════════════════════
//
// helpers/mcp (профиль + канал):
//   канал подписчиков (очередь на подписку, fan-out, регистрация/снятие, ожидание по signal) ·
//   _meta и io.modelcontextprotocol/* · resultType · server/discover вместо initialize ·
//   tools/list + tools/call · CacheableResult · subscriptions/listen (ack, agreed-subset,
//   MUST NOT-фильтр, subscriptionId, graceful-финал) · WIRE kind → notifications/* ·
//   POST-only/405 · Origin/403 · сверка заголовков + base64-сентинел · 202 ·
//   коды -32020/-32022, -32601/-32602 и HTTP-статусы · подсказка legacy-клиенту.
//
// helpers/http (generic-адаптер, предлагаемая версия src-шного fromSvelteKit):
//   каррирование fromSvelteKit(protocol) → handler (старая per-call форма сохранена) ·
//   headers + signal в запросе · SSE-фрейминг, если body — AsyncIterable · keep-alive ·
//   X-Accel-Buffering · pull-based backpressure · отмена без ожидания cleanup ·
//   body == null → тела нет.
//
// Четвёртая проекция `reply` НЕ нужна: поток едет в body существующего http-шва
// (TransportResponse.body уже unknown). Дельта к src аддитивна:
//   types.ts      TransportRequest += необязательные headers?, signal?
//   transport/    fromSvelteKit: каррирование + SSE-фрейминг + null-тело
//   protocol/     mcp() → modern-профиль + канал (замена legacy 2025-06-18)
//   фасад         McpChange, McpEndpoint (publish/close)
// Ни rest/jsonrpc/capnweb, ни fromWs/fromWsStream не меняются.

// ═══════════════════════════════════════════════════════════════════════════
// [3] ДЕМО-КЛИЕНТ И ПРОВЕРКИ КОНФОРМАНСА — не пользовательский код
// ═══════════════════════════════════════════════════════════════════════════

import { mcpDemoClient } from './helpers/mcp-client';
import type { McpChange } from './helpers/mcp';

const client = mcpDemoClient(POST);
const URI = 'file:///project/config.json';
const SUB = 'io.modelcontextprotocol/subscriptionId';

// Открыть подписку, дождаться ack (подписчик зарегистрирован), опубликовать доменные
// изменения, закрыть сервером и собрать кадры. Провод виден только здесь, в стенде.
async function subscribe(id: number, filter: Record<string, unknown>, changes: McpChange[]) {
  const res = await client.post('subscriptions/listen', { notifications: filter }, { id });
  const frames = client.frames(res);
  const ack = (await frames.next()).value;
  for (const c of changes) mcpEndpoint.publish(c);
  mcpEndpoint.close(); // graceful: финальный ответ, затем закрытие
  const rest: any[] = [];
  for (;;) {
    const r = await frames.next();
    if (r.done) break;
    rest.push(r.value);
  }
  await frames.return();
  return { res, ack, events: rest.slice(0, -1), final: rest.at(-1) };
}

(async () => {
  // server/discover вместо initialize: версии + capabilities + identity одним запросом.
  const discover = await client.json('server/discover');
  console.log('06 discover →', discover.result.supportedVersions, discover.result.resultType, discover.result._meta['io.modelcontextprotocol/serverInfo']);

  // tools/list — CacheableResult: ttlMs + cacheScope обязательны.
  const list = await client.json('tools/list', {}, { id: 2 });
  console.log('06 tools/list →', list.result.tools.map((t: any) => t.name), list.result.ttlMs, list.result.cacheScope);

  // tools/call → json-ответ (унарный), resultType обязателен.
  const call = await client.json('tools/call', { name: 'Math.count', arguments: { value: 41 } }, { id: 3 });
  console.log('06 tools/call →', call.result.content[0].text, call.result.resultType); // 42 complete

  // notification → 202 без тела.
  const notif = await client.post('notifications/whatever', {}, { id: null });
  console.log('06 notification →', notif.status, 'тело:', JSON.stringify(await notif.text())); // 202 ""

  // subscriptions/listen → SSE-поток в ответе на POST: ack, tagged-уведомления, graceful-финал.
  const full = await subscribe(7, { toolsListChanged: true, resourceSubscriptions: [URI] }, [
    { kind: 'tools-changed' },
    { kind: 'resource-updated', uri: URI },
    { kind: 'tools-changed' },
  ]);
  console.log('06 listen →', full.res.headers.get('content-type'), full.res.headers.get('x-accel-buffering'));
  console.log('06 listen ack →', full.ack.method, full.ack.params._meta[SUB], full.ack.params.notifications);
  console.log('06 listen events →', full.events.map((m) => m.method));
  console.log('06 listen final →', full.final.id, full.final.result.resultType);

  // Узкий фильтр: resources/updated не приходит (spec MUST NOT), ack отражает subset.
  const narrow = await subscribe(8, { toolsListChanged: true }, [
    { kind: 'tools-changed' },
    { kind: 'resource-updated', uri: URI },
    { kind: 'tools-changed' },
  ]);
  console.log('06 narrow ack →', narrow.ack.params.notifications, '| events →', narrow.events.map((m) => m.method));

  // Отмена: клиент закрыл поток ответа. Ожидание живёт внутри канала → prompt без signal
  // в пользовательском коде (раньше этот случай висел, пока транспорт ждал чужой cleanup).
  const cancelled = await client.post('subscriptions/listen', { notifications: { toolsListChanged: true } }, { id: 9 });
  const cs = client.frames(cancelled);
  console.log('06 cancel after →', (await cs.next()).value.method);
  const t0 = Date.now();
  await cs.return();
  console.log('06 cancel →', Date.now() - t0, 'ms');

  // Зеркалирование заголовков: Mcp-Name не совпал с телом → 400 + -32020 HeaderMismatch.
  const mismatch = await client.post('tools/call', { name: 'Math.count', arguments: { value: 41 } }, { id: 10, headers: { 'mcp-name': 'Math.add' } });
  console.log('06 header mismatch →', mismatch.status, (await mismatch.json()).error.code);

  // Неподдерживаемая версия → 400 + -32022 и список supported.
  const badVersion = await client.post('tools/list', {}, { id: 11, version: '1900-01-01' });
  const versionError = (await badVersion.json()).error;
  console.log('06 bad version →', badVersion.status, versionError.code, versionError.data);

  // Stateless: нет _meta с версией/capabilities → 400 + -32602.
  const noMeta = await client.post('tools/list', {}, { id: 12, noMeta: true });
  console.log('06 missing _meta →', noMeta.status, (await noMeta.json()).error.code);

  // Неизвестный метод → 404 + -32601.
  const unknown = await client.post('no/such-method', {}, { id: 13 });
  console.log('06 unknown method →', unknown.status, (await unknown.json()).error.code);

  // GET/DELETE прежних ревизий → 405; Mcp-Session-Id и Last-Event-ID игнорируются.
  console.log('06 GET/DELETE →', (await client.get({ 'mcp-session-id': 'sess-1' })).status, (await client.del()).status);

  // Origin present и невалиден → 403 (DNS rebinding, spec MUST).
  console.log('06 bad origin →', (await client.post('tools/list', {}, { id: 14, headers: { origin: 'https://evil.example' } })).status);

  // Legacy-клиент с initialize → 404 и подсказка: версии + server/discover.
  const legacy = await client.post('initialize', { protocolVersion: '2025-06-18' }, { id: 15, noMeta: true });
  console.log('06 legacy initialize →', legacy.status, (await legacy.json()).error.message);
})();
