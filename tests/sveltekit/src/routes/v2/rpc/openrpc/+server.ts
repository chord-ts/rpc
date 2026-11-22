// clef (@chord-ts/clef) — OpenRPC explorer + Try it-консоль как отдельный GET-binding:
// спека вшита inline, endpoint указывает на JSON-RPC-binding для Try it. Заменил hosted
// OpenRPC Playground (iframe): clef живёт на нашей странице — fetch спеки и CORS не нужны.
import { clef, fromSvelteKit } from '@chord/rpc';
import { _composer } from '../+server';

export const GET = (event: { request: Request }) =>
	fromSvelteKit(
		clef(_composer, {
			info: { title: 'v2 RPC demo', version: '1.0.0' },
			endpoint: '/v2/rpc',
			// transports: ['http'], // WS-адаптер в этом демо не смонтирован
		}),
		event,
	);