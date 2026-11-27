// formdata end-to-end: клиент шлёт multipart (boundary ставит платформа, не ручной content-type),
// сервер отвечает multipart; скаляры на проводе — строки (FormWire течёт в тип возврата клиента).

import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { compose, fromSvelteKit } from '../index';
import { post, rest as bindRest, openapi } from '@/rest';
import { formdata } from '@/format';
import { rest } from './index';
import type { OpenApiDoc } from './types';

class Catalog {
  static $create = post('/items', {
    body: z.object({ name: z.string() }),
    resp: { 200: z.object({ id: z.string(), count: z.number() }) },
  });
  create = Catalog.$create(async ({ name }) => ({ id: name, count: 42 }));
}

class Files {
  static $upload = post('/files', {
    // Файл приходит как File/Blob от платформы; JSON Schema его не выражает — z.unknown().
    body: z.object({ file: z.unknown() }),
    resp: { 200: z.object({ size: z.number() }) },
  });
  upload = Files.$upload(async ({ file }) => ({ size: (file as Blob).size }));
}

const composer = compose({ Catalog, Files });
const api = bindRest(composer, { format: formdata });
const doc = openapi(composer).document as OpenApiDoc;
const REST = (e: { request: Request }) => fromSvelteKit(api, e);
const loopback = (input: RequestInfo | URL, init?: RequestInit) => REST({ request: new Request(input, init) });

test('client sends multipart (platform boundary), scalars arrive as strings (FormWire)', async () => {
  let sent: Request | undefined;
  const client = rest<typeof api>({
    endpoint: 'http://localhost',
    doc,
    format: formdata,
    fetch: async (input, init) => {
      sent = new Request(input, init);
      return REST({ request: sent.clone() }); // оригинал остаётся непрочитанным для проверок
    },
  });
  const result = await client.Catalog.create({ name: 'widget' });
  // Запрос: multipart с boundary от платформы, без ручного content-type.
  expect(sent!.headers.get('content-type')).toContain('multipart/form-data; boundary=');
  expect((await sent!.formData()).get('name')).toBe('widget');
  // Ответ: count на проводе строка, не число.
  expect(result).toEqual({ id: 'widget', count: '42' });
  expectTypeOf(result.count).toEqualTypeOf<string>();
});

test('Blob/File upload round-trips end-to-end', async () => {
  const client = rest<typeof api>({ endpoint: 'http://localhost', doc, format: formdata, fetch: loopback });
  const result = await client.Files.upload({ file: new Blob(['hello']) });
  expect(result).toEqual({ size: '5' });
  expectTypeOf(result.size).toEqualTypeOf<string>();
});

test('server error encoded as multipart is decoded (422 detail reaches the client)', async () => {
  const client = rest<typeof api>({ endpoint: 'http://localhost', doc, format: formdata, fetch: loopback });
  await expect(client.Catalog.create({} as { name: string })).rejects.toMatchObject({ status: 422 });
});

test('non-multipart error body (HTML page) falls back to raw text, not a decode crash', async () => {
  const client = rest<typeof api>({
    endpoint: 'http://localhost',
    doc,
    format: formdata,
    fetch: async () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
  });
  await expect(client.Catalog.create({ name: 'x' })).rejects.toMatchObject({ status: 502, body: '<html>502 Bad Gateway</html>' });
});
