import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, stream, compose } from '../index';
import { get, openapi, swagger, redoc } from '@/rest';
import { openrpc, clef } from '@/jsonrpc';
import { asyncapi } from '@/events';
import { mcpTools } from '@/mcp';
import { ZodAdapter } from '../schemas/zod';

// REST-ресурс (сахар get). RPC-методы — отдельным классом (стили не смешиваются).
class Catalog {
  constructor() {}

  static $getItem = get('/items/{item_id}', {
    query: z.object({ q: z.string().optional() }),
    resp: { 200: z.object({ id: z.string() }) },
    desc: 'Получить предмет',
    tags: ['items'],
  });
  getItem: typeof Catalog.$getItem.fn = async () => ({ id: 'x' });
}

class Math {
  constructor() {}
  static $count = fn({ in: z.number(), out: z.number(), desc: 'Инкремент' });
  count: typeof Math.$count.fn = async (n) => n + 1;
  static $add = fn({ in: z.object({ a: z.number(), b: z.number().optional() }), out: z.number() });
  add: typeof Math.$add.fn = async ({ a, b }) => a + (b ?? 0);
  static $ping = fn({ in: z.void(), out: z.string() });
  ping: typeof Math.$ping.fn = async () => 'pong';
  static $repeat = fn({ in: z.tuple([z.string(), z.number()]), out: z.string() });
  repeat: typeof Math.$repeat.fn = async (text, times) => text.repeat(times);
  static $pad = fn({ in: z.tuple([z.string(), z.number(), z.string().optional()]), out: z.string() });
  pad: typeof Math.$pad.fn = async (text, width, fill) => text.padStart(width, fill ?? ' ');
  static $sumAll = fn({ in: z.array(z.number()), out: z.number() });
  sumAll: typeof Math.$sumAll.fn = async (nums) => nums.reduce((a, b) => a + b, 0);
  static $old = fn({ in: z.void(), out: z.string(), summary: 'Устарело', desc: 'Старый метод', tags: ['legacy'], deprecated: true });
  old: typeof Math.$old.fn = async () => 'old';
  static $decorated = fn({ in: z.void(), out: z.string(), desc: 'нейтральная', mcp: { title: 'MCP Title', desc: 'mcp desc', annotations: { readOnlyHint: true }, name: 'decorated_tool' } });
  decorated: typeof Math.$decorated.fn = async () => 'ok';
}

// Карман mcp типизирован (автокомплит), не открытый any: title обязан быть string.
// @ts-expect-error — mcp.title: number не проходит (поле типизировано)
fn({ in: z.void(), out: z.string(), mcp: { title: 123 } });

const composer = compose({ Catalog, Math }, { inject: {}, schemas: new ZodAdapter() });

test('openapi: REST endpoint → path/query parameters + resp status', () => {
  const doc = openapi(composer, { info: { title: 'Catalog', version: '1.0.0' } }).document as any;
  expect(doc.openapi).toBe('3.1.0');
  const get = doc.paths['/items/{item_id}'].get;
  expect(get.description).toBe('Получить предмет');
  const params = get.parameters;
  expect(params.find((p: any) => p.name === 'item_id')).toMatchObject({ in: 'path', required: true });
  expect(params.find((p: any) => p.name === 'q')).toMatchObject({ in: 'query', required: false });
  expect(get.responses['200'].content['application/json'].schema).toMatchObject({ type: 'object' });
  expect(get.tags).toEqual(['items']); // явные tags перебивают дефолт-тег из имени класса
  // fn-метод без rest в OpenAPI не попадает
  expect(doc.paths['/items']).toBeUndefined();
});

test('openrpc: only fn methods (REST filtered out)', () => {
  const doc = openrpc(composer).document as any;
  const names = doc.methods.map((m: any) => m.name);
  expect(names).toContain('Math.count');
  expect(names).not.toContain('Catalog.getItem');
  // дефолт-тег из имени класса — группировка в clef
  expect(doc.methods.find((m: any) => m.name === 'Math.count').tags).toEqual([{ name: 'Math' }]);
});

test('openrpc: params — object by-name, tuple by-position, void → [], скаляр → один params', () => {
  const doc = openrpc(composer).document as any;
  const method = (name: string) => doc.methods.find((m: any) => m.name === name);
  // object-вход раскладывается на дескрипторы по полям: clef шлёт {a, b} — ровно то, что ждёт сервер
  expect(method('Math.add').params).toEqual([
    { name: 'a', required: true, schema: { type: 'number' } },
    { name: 'b', required: false, schema: { type: 'number' } },
  ]);
  expect(method('Math.add').paramStructure).toBe('by-name');
  expect(method('Math.ping').params).toEqual([]); // void → params omitted
  // скаляр — вырожденный tuple из одного аргумента: позиционный дескриптор arg0, провод [value]
  expect(method('Math.count').params).toEqual([{ name: 'arg0', required: true, schema: { type: 'number' } }]);
  expect(method('Math.count').paramStructure).toBe('by-position');
  // tuple → позиционный дескриптор на элемент (JSON-RPC by-position): порядок = порядок аргументов,
  // required по minItems — optional-хвост после обязательных (требование OpenRPC к порядку params)
  expect(method('Math.repeat').params).toEqual([
    { name: 'arg0', required: true, schema: { type: 'string' } },
    { name: 'arg1', required: true, schema: { type: 'number' } },
  ]);
  expect(method('Math.repeat').paramStructure).toBe('by-position');
  expect(method('Math.pad').params).toEqual([
    { name: 'arg0', required: true, schema: { type: 'string' } },
    { name: 'arg1', required: true, schema: { type: 'number' } },
    { name: 'arg2', required: false, schema: { type: 'string' } },
  ]);
  // обычный массив — одиночное значение-массив: один позиционный дескриптор arg0, провод [[…]]
  expect(method('Math.sumAll').params).toEqual([
    { name: 'arg0', required: true, schema: { type: 'array', items: { type: 'number' } } },
  ]);
  expect(method('Math.sumAll').paramStructure).toBe('by-position');
});

test('openrpc: нейтральная мета — summary/desc/tags/deprecated (deprecated опционально)', () => {
  const doc = openrpc(composer).document as any;
  const method = (name: string) => doc.methods.find((m: any) => m.name === name);
  const old = method('Math.old');
  expect(old.summary).toBe('Устарело');
  expect(old.description).toBe('Старый метод');
  expect(old.tags).toEqual([{ name: 'legacy' }]);
  expect(old.deprecated).toBe(true);
  // без явного deprecated — default false (генератор эмитит поле всегда, спека валидна)
  expect(method('Math.count').deprecated).toBe(false);
  // OpenAPI эмитит deprecated тем же полем
  const rest = openapi(composer).document as any;
  expect(rest.paths['/items/{item_id}'].get.deprecated).toBeUndefined();
});

test('mcpTools: mcp-мета приоритетнее нейтральной (title/desc), карман типизирован', () => {
  const { tools } = mcpTools(composer).document as any;
  const d = tools.find((t: any) => t.name === 'decorated_tool'); // mcp.name задаёт плоское имя тула
  expect(d.title).toBe('MCP Title');
  expect(d.description).toBe('mcp desc'); // mcp.desc перебивает нейтральную desc
});

test('mcpTools: all endpoints, REST flattened + auto-path, fn scalar wrapped', () => {
  const { tools } = mcpTools(composer).document as any;
  const getItem = tools.find((t: any) => t.name === 'Catalog.getItem');
  expect(Object.keys(getItem.inputSchema.properties)).toEqual(expect.arrayContaining(['item_id', 'q']));
  expect(getItem.inputSchema.required).toContain('item_id');
  expect(getItem.annotations.readOnlyHint).toBe(true);

  const count = tools.find((t: any) => t.name === 'Math.count');
  expect(count.inputSchema).toMatchObject({ type: 'object', properties: { value: { type: 'number' } } });
});

test('generate works without registered adapter (generic fallback)', () => {
  const bare = compose({ Catalog }, { inject: {} });
  const doc = openapi(bare).document as any;
  // defaultSchemas reads zod ~standard.jsonSchema natively
  expect(doc.paths['/items/{item_id}'].get.responses['200'].content['application/json'].schema).toMatchObject({ type: 'object' });
});

class Ticker {
  constructor() {}
  static $countdown = stream({ in: z.object({ from: z.number() }), event: z.object({ n: z.number() }), desc: 'Обратный отсчёт' });
  countdown: typeof Ticker.$countdown.fn = async function* ({ from }) {
    for (let n = from; n > 0; n--) yield { n };
  };
}

test('asyncapi: канал на stream-эндпоинт (send=in, receive=event); unary-генераторы stream не берут', () => {
  const c = compose({ Catalog, Math, Ticker }, { inject: {}, schemas: new ZodAdapter() });
  const doc = asyncapi(c).document as any;
  expect(doc.asyncapi).toBe('3.0.0');
  const ch = doc.channels['Ticker.countdown'];
  expect(ch.address).toBe('Ticker.countdown');
  expect(ch.messages.params.payload).toMatchObject({ type: 'object' });
  expect(ch.messages.event.payload.properties.n).toMatchObject({ type: 'number' });
  expect(doc.operations['Ticker.countdown.send'].action).toBe('send');
  expect(doc.operations['Ticker.countdown.receive'].action).toBe('receive');
  // только stream-эндпоинты: unary в AsyncAPI не попадают
  expect(Object.keys(doc.channels)).toEqual(['Ticker.countdown']);

  const rpc = openrpc(c).document as any;
  expect(rpc.methods.map((m: any) => m.name)).not.toContain('Ticker.countdown');
  const { tools } = mcpTools(c).document as any;
  expect(tools.map((t: any) => t.name)).not.toContain('Ticker.countdown');
});

test('генератор — binding: http отдаёт документ (raw JSON), .document доступен', async () => {
  const spec = openrpc(composer);
  const res = await spec.http.handle({ method: 'GET', url: 'http://localhost/openrpc.json', body: undefined });
  expect(res.status).toBe(200);
  expect(res.raw).toBe(true);
  expect(res.headers?.['content-type']).toBe('application/json');
  expect(JSON.parse(res.body as string)).toEqual(spec.document);
});

test('swagger/redoc — UI-binding: inline spec, text/html, путь маунта не важен', async () => {
  // binding не смотрит на url — пользователь вешает его на любой GET-роут (нет предположения о корне).
  const sw = await swagger(composer).http.handle({ method: 'GET', url: 'http://localhost/v2/rest/docs', body: undefined });
  expect(sw.status).toBe(200);
  expect(sw.raw).toBe(true);
  expect(sw.headers?.['content-type']).toContain('text/html');
  expect(sw.body).toContain('SwaggerUIBundle');
  expect(sw.body).toContain('"openapi":"3.1.0"'); // документ вшит inline, без отдельного URL/CORS
  expect(sw.body).toContain('/items/{item_id}');

  const rd = await redoc(composer).http.handle({ method: 'GET', url: 'http://localhost/anywhere/redoc', body: undefined });
  expect(rd.status).toBe(200);
  expect(rd.headers?.['content-type']).toContain('text/html');
  expect(rd.body).toContain('Redoc.init');
  expect(rd.body).toContain('"openapi":"3.1.0"');
});

test('clef — UI-binding: inline OpenRPC-spec + endpoint/transports для Try it', async () => {
  const res = await clef(composer, { endpoint: '/rpc', transports: ['http'] }).http.handle({ method: 'GET', url: 'http://localhost/v2/rpc/openrpc', body: undefined });
  expect(res.status).toBe(200);
  expect(res.raw).toBe(true);
  expect(res.headers?.['content-type']).toContain('text/html');
  expect(res.body).toContain('clef.mount');
  expect(res.body).toContain('"openrpc":"1.3.2"'); // документ вшит inline, без fetch/CORS
  expect(res.body).toContain('Math.count');
  expect(res.body).toContain('"endpoint":"/rpc"');
  expect(res.body).toContain('"transports":["http"]');

  // без opts — только spec: undefined-поля не сериализуются
  const bare = await clef(composer).http.handle({ method: 'GET', url: 'http://localhost/docs', body: undefined });
  expect(bare.body).not.toContain('"endpoint"');
  expect(bare.body).not.toContain('"transports"');
});