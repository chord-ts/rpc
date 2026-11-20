// REST-манифест доставляется через load: сервер отдаёт OpenAPI на /v2/rest/openapi.json.
import type { Load } from '@sveltejs/kit';

export const load: Load = async ({ fetch }) => {
  const doc = await (await fetch('/v2/rest/openapi.json')).json();
  console.log(doc)
  return { doc };
};