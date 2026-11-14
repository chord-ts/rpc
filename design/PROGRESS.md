# Прогресс v2.0 по спеке

> Компаньон к [`ROADMAP.md`](./ROADMAP.md) и дизайн-докам (`design/v2-registration.md`,
> `design/v2-exec-pipeline.md`). Статус по фактическому коду, а не по намерениям.

## 1. Версии и миграция (v1 deprecated → v2)

- [x] Рантайм физически вынесен в `src/v1`, сборка в `dist/v1` (корень `.` пока на v1).
- [ ] `@deprecated` на публичных v1-экспортах — отложено до готовности v2 (решится понятнее после).
- [ ] `exports` для v2 и фасада `./v1`, прогон `publint`/`attw`.

## 2. Регистрация (schema-first, без декораторов)

- [x] `static $method = fn({ in, out, use })`, тип метода из фантомного `$method.fn` (тип `Fn`).
- [x] Обработчики всегда async: `(input) => Promise<Out>`.
- [x] `toRPC({ … }, { inject })` → `{ instantiate, exec }`.
- [x] DI через конструктор + строгая типизация `Injector<S>` (public parameter-properties).
- [x] `Client` из классов: Promise-wrapped, `#`/`private` исключены.
- [x] simple-эндпоинты без `$method` (обход прототипа, приватность через `#`).
- [x] per-fn middleware `use`.
- [ ] `z.tuple([...])` — позиционные вызовы (открытый вопрос).
- [ ] `description`/`deprecated`/`tags`/`meta` в контракте (нужно для генерации).

## 3. Единый источник валидации (schema-agnostic)

- [x] Ядро на вендореном `AnySchema` (Standard Schema v1, async `validate`).
- [x] Native `~standard` напрямую: zod 4 (devDep `zod4`), valibot, arktype.
- [x] yup shim (`validators/yup`) — мост для библиотек без `~standard`.
- [x] zod 3 выпилен (шим, тест, `zod` и `@anatine/zod-mock` из зависимостей).
- [ ] Typia — нужен compiler-трансформер (отдельная инфраструктурная задача).

## 4. Exec-пайплайн

- [x] `exec(body, { ctx })` — ядро транспорт-агностично.
- [x] normalize → route → middleware-цепочка (рекурсия) → invoke.
- [x] validate(in) → invoke → validate(out) (один валидатор).
- [x] Типизированный `Result` + `ErrorObject` (InvalidParams/MethodNotFound/InternalError).
- [x] Batch коррелируется по id, notification — без ответа.
- [ ] Клиентская граница `batch(...) => Result[]`.
- [ ] Изоляция ctx между элементами batch (сейчас один общий `opts.ctx`, мутации протекают).
- [ ] Адаптеры `fromSvelteKit` / `fromExpress`.

## 5. Транспорт (call / notify / stream)

- [x] call / notify на серверной части.
- [ ] stream (SSE / WebSocket).
- [ ] Форматы: MessagePack/CBOR/NDJSON, searchParams/formData/binary, encryption.

## 6. Генерация артефактов

- [ ] OpenRPC → OpenAPI → MCP (в v1 есть зародыш `getSchema`, v2-генератор не начат).

## 7. Долги по типам и ошибкам

- [x] Честный `Promise<Returned>` на клиенте (`Client`).
- [ ] Типизированные ошибки (контракт) и per-item ошибки batch на клиенте.

## Тесты

- [x] `tests/v2` — register/exec/validators, 18 тестов.
- [x] type-spike: `v2-types`.
- [ ] v1 `batch`/`spec` — падают (pre-existing shared-state в `Composer`), не чинил.

## Главная ставка / риски

- Ставка не изменилась: одна схема → типы + рантайм-валидация + JSON Schema → OpenRPC/OpenAPI/MCP.
  Фундамент (регистрация + валидация + exec) готов, генерация — надстройка над ним.
- Главный риск сейчас — v1-фасад (`@deprecated`, `exports`, `publint`/`attw`): без него публикация
  v2 сломает текущих потребителей или даст шум.
- Самые большие неразмеченные куски — транспорт (stream/SSE/WS) и генерация артефактов.

## Не проверял

- `publint`/`attw` и полный `pnpm build` (tsdown/terser) — не гонял; только `tsc --noEmit` и vitest.