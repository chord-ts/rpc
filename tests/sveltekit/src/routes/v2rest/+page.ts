// REST-манифест доставляется через load: сервер отдаёт OpenAPI на /v2rest/openapi.json.
import type { Load } from '@sveltejs/kit';

export const load: Load = async ({ fetch }) => {
  const doc = await (await fetch('/v2rest/openapi.json')).json();
  return { doc };
};