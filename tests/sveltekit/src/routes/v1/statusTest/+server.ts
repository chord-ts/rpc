// Демо статус-aware транспорта v1: сервер по имени метода отдаёт разные HTTP-сценарии.
// ok → JSON-RPC 200; error500/error404 → HTML-страницы ошибки; nonjson → 200 text/plain;
// redirect → 303 (транспорт сам navigates). error-сценарии перехватываются до composer.exec.
import { json, redirect } from '@sveltejs/kit';
import { Composer, rpc } from '@chord/rpc';
import { sveltekitMiddleware } from '@chord/rpc/middlewares';

class Status {
  @rpc()
  ok() {
    return 'all good';
  }
  @rpc()
  error500() {
    return '';
  }
  @rpc()
  error404() {
    return '';
  }
  @rpc()
  nonjson() {
    return '';
  }
  @rpc()
  redirect() {
    return '';
  }
}

const composer = Composer.init({ Status: new Status() });
composer.use(sveltekitMiddleware());

export type Client = typeof composer.clientType;

const html = (body: string, status: number, statusText: string) =>
  new Response(body, { status, statusText, headers: { 'content-type': 'text/html; charset=utf-8' } });

export async function POST(event: { request: Request }) {
  const method = (await event.request.clone().json())?.method as string;

  if (method === 'Status.error500') {
    return html('<html><body><h1>500 — Internal Server Error</h1><p>Something broke on the server.</p></body></html>', 500, 'Internal Server Error');
  }
  if (method === 'Status.error404') {
    return html('<html><body><h1>404 — Not Found</h1><p>No such resource.</p></body></html>', 404, 'Not Found');
  }
  if (method === 'Status.nonjson') {
    return new Response('this is plain text, not json', { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  if (method === 'Status.redirect') {
    throw redirect(303, '/v1/statusTest/landed');
  }

  return json(await composer.exec(event));
}