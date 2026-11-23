# MCP conformance: официальный рефери против chord endpoint

Наша реализация MCP-сервера опирается не на самописные проверки, а на **официальный
conformance-набор** Model Context Protocol. Рефери ходит по HTTP к нашему endpoint как
настоящий клиент — чёрный ящик, без привязки к API TypeScript SDK.

## Что откуда

| Что | Откуда |
|---|---|
| Рефери `@modelcontextprotocol/conformance` | npm, MIT. Пин **точный**: `0.2.0-alpha.12` — тот же, что у апстрима |
| Набор сценариев | заморожен ревизией `--requirements 2026-07-28` (50 запускается, 37 scored) |
| Формат baseline | `modelcontextprotocol/typescript-sdk` → `test/conformance/expected-failures*.yaml` |
| Fixture-контракт (`fixtures.ts`) | там же → `test/conformance/src/everythingServer.ts`, пин коммита `5ee54ee30ddc00a914a3d981880f87fdce0e6246` |
| Спека ревизии | снапшот `design/specs/mcp-2026-07-28-streamable-http.md` |

Апстрим пинит рефери точно и пересобирает baseline тем же изменением, которым бампает пин.
Делаем так же.

## Файлы

```
src/mcp/tests/
  conformance.test.ts     запуск рефери + ratchet (vitest, src/**/*.test.ts)
  harness.ts              node:http ↔ fetch мост, endpoint на 127.0.0.1:random, стриминг SSE
  fixtures.ts             fixture-контракт апстрима декларациями chord
  expected-failures.yaml  baseline (ratchet)
```

`tsconfig.build.json` исключает `src/**/tests/**` из dts-emit — проверено: в `dist`-раскладку
попадает только `mcp/index.d.ts`. `@types/node` добавлен в devDependencies: harness
использует `node:http`, а тесты теперь внутри `src` и попадают в `pnpm typecheck`.

Под тестом сейчас **спайк-реализация** (`design/examples/helpers/{mcp,http}`) — после переноса
в `src/mcp` меняются импорты в harness, сценарии и baseline не трогаются.

## Запуск

```bash
pnpm test:mcp          # прогон + ratchet по baseline (зелёный = нет регрессий и нет stale)
pnpm test:mcp:report   # только отчёт, без assert на код возврата
```

## Fixture-контракт

Клонирован **контракт, а не код** апстримного `everythingServer.ts` (1659 строк под API SDK):
имена, схемы и поведение, выраженные через `fn` + meta, чтобы шли валидация, DI и реестр chord.

- Имена тулов в MCP плоские (`test_image_content`), реестр chord адресует `Service.method` →
  имя задаётся через `mcp.name`, профиль строит индекс.
- Resources/prompts различаются meta-полями `mcp.resource` / `mcp.prompt` и в `tools/list`
  не попадают. Ядро не менялось: `fn<C extends Contract>` пропускает meta в реестр.
- Объём — scored-набор 2026-07-28. Legacy-тулы прежних ревизий (`test_sampling`,
  `test_elicitation`, `test_reconnection`, `test_logging_tool`) и tasks-расширение SEP-2663
  не клонируются: нашим набором они не скорятся.

## Ratchet, а не индульгенция

Рефери падает на **unexpected failure** (регрессия) и на **stale entry** (сценарий из списка
начал проходить → убери строку). Проверено вживую: добавление проходящего сценария даёт
«Stale baseline entries (now passing — remove from baseline)» и exit 1.

**Подвох со WARNING.** Pretty-сводка печатает `✓ N passed, 0 failed` для сценариев, у которых
проверки имеют статус `WARNING` (SHOULD-требования), но reconciliation считает WARNING
непрохождением. Такие сценарии обязаны быть в baseline и помечены `(WARNING)`. На этом
уже спотыкались: снятие двух таких строк по pretty-сводке сделало прогон красным.

## Текущее состояние (2026-11-19)

**127 passed / 44 failed checks; 23 из 37 scored-сценариев проходят, 14 в baseline.**
До fixture-контракта было 106/62 и 6 чистых сценариев.

Закрыто fixture-контрактом и поддержкой профиля: `tools-list`, контент-тулы (image/audio/
embedded/mixed), `completion-complete`, `resources-list`/`read-text`/`read-binary`/
`templates-read`, `prompts-list` и все `prompts-get-*`, `caching`, `sep-2164-resource-not-found`
(-32602 + `data.uri` вместо -32601).

Осталось (по корневым причинам):

1. **MRTR (SEP-2322)** — 12 сценариев: `resultType: 'input_required'`, `inputRequests`,
   `requestState`, multi-round, tampered-state, capability gating. Fixture-тулы
   `test_input_required_result_*` и `test_missing_capability` ждут именно этого.
2. **-32021 MissingRequiredClientCapability** — не гейтим по заявленным capabilities клиента
   (оставшиеся 2 проверки `server-stateless`).
3. **Request-scoped `notifications/progress`** — канал подписок есть, но progress не привязан
   к конкретному запросу (`tools-call-with-progress`).

Не scored при `--requirements 2026-07-28` (в baseline НЕ входят, иначе stale): `tasks-*`
(SEP-2663), `json-schema-2020-12` (нужен hand-authored JSON Schema 2020-12 — zod такие
ключевые слова не эмитит), `http-header-validation` (14/14 проходит),
`http-custom-header-server-validation` (SEP-2243 `x-mcp-header` — ни один тул не аннотирован).

## Лицензии

MCP-проект в переходе MIT → Apache-2.0 (новый код и спека — Apache-2.0, доки — CC-BY-4.0,
неперелицензированные вклады остаются MIT). Рефери на npm — MIT. chord — Apache-2.0,
совместимо в обе стороны. Fixture-контракт клонирован с указанием источника и пина коммита.
