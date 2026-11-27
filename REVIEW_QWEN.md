# Chord RPC v2 → v1: промежуточные выводы ревью (main..v2)

**Статус на 2026-11-26:** фаза поиска завершена полностью (38/38 чанков, 40 агентов). Фаза
верификации и обратный аудит **не запускались** — волна отменена пользователем. Поэтому **все
находки ниже — кандидаты от агентов-искателей с их высокой уверенностью, не подтверждённые
верификатором**. Многие из них агенты подкрепили исполненным свидетелем (запускали код, ts-компилятор,
resolver), но формального вердикта Step 4 пока нет. Вердикт не собран (compose-review не запускался).

Полный список с failure-сценариями и предлагаемыми исправлениями:
`.qwen/tmp/qwen-review-local-findings.json.md`.

## Criticals — 31 кандидат

| # | Где | Что |
|---|-----|-----|
| C01 | package.json exports | Нет `./v1` и `./v1/client` в exports, а `@deprecated`-подсказки (и MIGRATION) шлют туда: `ERR_PACKAGE_PATH_NOT_EXPORTED` (executed) |
| C02 | MIGRATION.md:379 | Сниппет `compose(..., { use: auth })` не компилируется: `Middleware<{user?}>` vs `MaybeArray<Middleware<unknown>>` — TS2322 (typechecked) |
| C03 | MIGRATION.md:84 | `typeof clientType` — такого идентификатора нет в v1, TS2304 |
| C04 | MIGRATION.md:452 | «Executed» ответ придуман: plain Error маппится в `-32603 "Internal error"`, не в сообщение |
| C05 | MIGRATION.md:535 | `/boom → {"detail":"handler exploded"}` противоречит rest.ts:218 и своему же тесту H3 |
| C06 | MIGRATION.md:637 | «Middleware is not applied around streams yet» — ложь, core.stream оборачивает в onion |
| C07 | MIGRATION.md:597, 635 | «WS client serializes calls» — ложь, мультиплексирует по id |
| C08 | src/client/index.ts:149-150 | wsCall виснет навсегда после close; утечка pending при брошенном send (executed, HUNG) |
| C09 | src/client/index.ts:67-68 | restProfile при `$ref`-body-схеме молча шлёт POST без тела (executed); класc «unbounded» — нужен fail-closed |
| C10 | src/core/index.ts:70-74 | Ручной парсинг ctor.toString(): `reconstructor()` ломает DI — тихая мисинжекция `undefined` (executed) |
| C11 | src/events/events.ts:12-13 | Фрейм `null` → синхронный TypeError → unhandled rejection → смерть процесса (executed) |
| C12 | src/transport/ws.ts:61-64 | `stream.handle`/`prev.return()` вне try/catch — тот же крах + остановленная подписка (executed) |
| C13 | src/events/docs.ts:19 | AsyncAPI params-схема рендерится на output-стороне: документ противоречит валидации (executed) |
| C14 | src/events/docs.ts:23-25 | Имя канала вставляется в JSON Pointer без экранирования `/` и `~` (executed) |
| C15 | src/format/types.ts:14 | `NonNullable` стирает легитимный `null` из клиентских типов (executed, TS compiler API) |
| C16 | src/format/types.ts:25-26 | Массивная ветка сплющивает кортежи: `[number, Date]` → `(string\|number)[]` (executed) |
| C17 | src/generate/mcp-tools.ts:48 | Типизированные `mcp.annotations` молча выбрасываются (executed) |
| C18 | src/generate/core.ts:9-10 | Override `jsonSchema` теряет сторону `io` → inputSchema с лишним `required` (executed) |
| C19 | src/jsonrpc/docs.ts:48 | Переписываются только `#/$defs/`-ref'ы; голый `#` рекурсивной схемы висит (executed) |
| C20 | src/mcp/tests/fixtures.ts:18 | Импорт корня пакета резолвится в gitignored `dist/`: свежий клон не запустит conformance-гейт (executed resolver) |
| C21 | src/mcp/vercel/index.ts:51-54 | void-результат → `text: undefined` → невалидный MCP content block (executed) |
| C22 | src/rest/docs.ts:17-18, 39, 57, 63 | `$defs`-ref'ы в OpenAPI-документе висят: нет components, docs ломаются на рекурсивных схемах (executed) |
| C23 | src/rest/rest.ts:204 | `?__proto__=a&__proto__=b` меняет прототип query → инжект полей в handler input (executed) |
| C24 | src/rest/rest.ts:98 | Валидное array-body сплющивается в `{0:…}`, scalar теряется → 500 на валидном запросе (executed) |
| C25 | src/rest/rest.ts:138-139 | ReDoS: соседние `{a}{b}{c}` → каскадный backtracking, 14.9 s на 3000 символах (executed) |
| C26 | src/schemas/index.ts:117-118 | `in`-оператор: параметр `{toString}`/`{constructor}` пропадает из рекламируемой схемы; `{__proto__}` ставит прототип (executed) |
| C27 | src/tools/index.ts:13 | agentTools пакует transform-схемы на output-стороне: каждый валидный вызов падает (executed) |
| C28 | src/tools/index.ts:29 | `func` возвращает `undefined` для void/204, нарушая `Promise<string>` (executed) |
| C29 | src/tools/index.ts:11 | Слой tools недостижим из пакета: нет `./tools` в exports и entry (executed: ERR_PACKAGE_PATH_NOT_EXPORTED) |
| C30 | src/v1/client/defaults.ts:26-28 | `res.redirected` выбрасывает валидный 200-RPC-результат и навигирует браузер — регрессия vs старый v1 (executed) |
| C31 | tests/sveltekit/tests/v2-rpc.test.ts:18 | Регэксп `rpc.discover:` не может сматчиться (`rpc.discover (POST):` + 6 пропущенных методов) — playwright-спек падает всегда |

## Suggestions — 18 кандидатов

- S01 `.gitignore:6` — `logo` не заякорён, матчит любую глубину.
- S02 `src/jsonrpc/types.ts:16` — `RPCResponse` допускает ни `result`, ни `error` (нетипизированнее секции 5).
- S03 `MIGRATION.md:243` — `await` внутри не-async стрелки в v1-контрасте.
- S04 `README.md:143-144` — «Before (v1)» без `json()`-обёртки: сниппет возвращает объект вместо Response.
- S05 `pnpm-lock.yaml:1926` — engines tsdown `^22.18` против `engines.node >= 20` в package.json.
- S06 `src/v1/server/index.ts:481` — заглушка `getMetadata` молча опустошает v1-метаданные.
- S07 `src/v1/server/index.ts:273-275` — fallback принимает любое `.method` → MethodNotFound вместо InvalidRequest.
- S08 `src/validators/yup.ts:15` — `validateSync` не выполняет async-тесты yup.
- S09 `src/validators/index.ts:1` — yup-shim экспортирован из барреля, которого нет в пакете (low).
- S10 `src/v1/client/defaults.ts:35-37` — **все** заголовки, включая `set-cookie`, пишутся в `console.error` (логи в SSR).
- S11 `src/client/index.ts:84` — отсутствующий path-параметр становится `"undefined"` в URL.
- S12 `src/client/review.test.ts:74-75` — B8 не ловит FIFO-регрессию (replies в порядке запросов).
- S13 `src/rest/rest.ts:196` — 405 без заголовка `Allow` (RFC 9110 MUST).
- S14 `src/client/index.ts:17, 24` — неиспользуемые импорты `ServiceMap`/`WsClientInit` (lint error по конфигу).
- S15 `src/transport/ws.ts:61-64` — замена подписки не покрыта тестом.
- S16 `src/mcp/vercel/index.ts:103-104` — DI-обвязка `opts.ctx` не покрыта тестом.
- S17 `src/generate/review.test.ts:39-41` — B9 не проверяет уникальность ключей между методами.
- S18 `src/client/index.ts:86` — массив query при клиенте схлопывается в `"a,b"` (low).

## Nice-to-have — 2

- N01 `src/client/types.ts:3` — в комментарии несуществующий `clientJsonRPC` (на деле `jsonrpc`).
- N02 `src/mcp/tests/conformance.test.ts:48` — `mkdtempSync`-отчёт никогда не удаляется из /tmp.

## Как продолжить (resume)

1. Волна верификации **подготовлена и лежит на диске**: 7 манифестов верификаторов
   (`.qwen/tmp/qwen-review-local-verify-0-{1..7}.json`) + 2 манифеста раундов обратного аудита
   (`-ra-round1.json`, `-ra-round2.json`), скрипт уже выпущен
   (`emit-workflow --batch` над всеми 9; 83 агента).
2. Запустить волну одним вызовом `workflow` по `scriptPath` из `emit-workflow` (или вручную через
   agent-инструмент с `subagent_type: "review-agent"` и промптами из `.qwen/tmp/qwen-review-local-wave2/`).
3. Дальше по пайплайну: `check-coverage` → слить вердикты в накопительный список → при необходимости
   раунд 3+ обратного аудита → `compose-review` → отчёт и `report_findings` → cleanup local.

Строго не верифицировано (worst-case в отчёте явно оговорить): все 51 пункты выше до прохождения Step 4.