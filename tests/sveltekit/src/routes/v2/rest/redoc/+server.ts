// ReDoc как отдельный GET-binding: документ вшит inline, путь маунта выбираем сами.
import { fromSvelteKit } from '@chord/rpc';
import { redoc } from '@chord/rpc/rest';
import { _composer } from '../[...path]/+server';

export const GET = (event: { request: Request }) => fromSvelteKit(redoc(_composer, { info: { title: 'v2 REST demo', version: '1.0.0' } }), event);