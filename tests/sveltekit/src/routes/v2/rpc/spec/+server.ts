// GET /v2/rpc/spec — OpenRPC-спека одной строкой: генератор возвращает binding, fromSvelteKit отдаёт
// его документ. Отдельный роут, чтобы GET не конфликтовал с +page.svelte на /v2/rpc.
import { openrpc, fromSvelteKit } from '@chord/rpc';
import { composer } from '../+server';

export const GET = (event: { request: Request }) =>
	fromSvelteKit(openrpc(composer, { info: { title: 'v2 RPC demo', version: '1.0.0' } }), event);