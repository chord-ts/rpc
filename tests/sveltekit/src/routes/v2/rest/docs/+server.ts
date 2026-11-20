// Swagger UI как отдельный GET-binding: документ вшит inline, отдельный openapi-маунт/CORS не нужны.
import { swagger, fromSvelteKit } from '@chord/rpc';
import { _composer } from '../[...path]/+server';

export const GET = (event: { request: Request }) =>
	fromSvelteKit(
    swagger(
      _composer, 
      { info: { title: 'v2 REST demo', version: '1.0.0' } }
    ), 
    event
  );
