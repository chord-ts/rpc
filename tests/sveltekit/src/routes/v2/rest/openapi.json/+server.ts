// OpenAPI-спека как отдельный GET-binding: путь маунта выбираем сами (/v2/rest/openapi.json).
import { openapi, fromSvelteKit } from '@chord/rpc';
import { _composer } from '../[...path]/+server';

export const GET = (event: { request: Request }) => fromSvelteKit(openapi(_composer, { info: { title: 'v2 REST demo', version: '1.0.0' } }), event);