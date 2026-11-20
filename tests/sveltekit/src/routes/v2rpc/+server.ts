// v2 RPC-эндпоинт: импорт из опубликованного пакета (@chord/rpc → dist через exports-карту).
// Корень реэкспортит v1+v2; compose/fn/jsonrpc — v2-имена без суффикса версии.
import { compose, fn, jsonrpc, fromSvelteKit } from '@chord/rpc';
import { z } from 'zod';

class Math {
  constructor() {}
  static $add = fn({ in: z.object({ a: z.number(), b: z.number() }), out: z.number() });
  add: typeof Math.$add.fn = async (x) => x.a + x.b;
}

const composer = compose({ Math });
export const api = jsonrpc(composer);
export type Api = typeof api;

export const POST = (event: { request: Request }) => fromSvelteKit(api, event);