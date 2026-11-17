// Пользовательский код: байтовый шов (вариант A). Один compose обслуживается двумя форматами —
// текстовым json и бинарным mock — через один байтовый биндинг. Тело провода — Uint8Array.
// Прогон типов:
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-bytes.example.ts

import { z } from 'zod';
import { fn, compose } from '../src';
import { jsonrpcBytes, json, mockBinary, fromSvelteKit, type TransportRequest } from './v2-bytes.helpers';

class Math {
  constructor() {}
  static $add = fn({ in: z.object({ a: z.number(), b: z.number() }), out: z.number() });
  add: typeof Math.$add.fn = async (x) => x.a + x.b;
}

const composer = compose({ Math });

// Loopback-запрос: тело codec'ится тем же форматом, что и ответ.
const request = (format: typeof json, body: unknown): TransportRequest => ({
  method: 'POST',
  url: 'http://localhost/rpc',
  bytes: async () => format.encode(body),
});

(async () => {
  // Один биндинг, два формата: json (текст поверх байтов) и mock-binary (непрозрачные байты).
  for (const format of [json, mockBinary]) {
    const binding = jsonrpcBytes(composer, { format });
    const res = await binding.handle(request(format, { jsonrpc: '2.0', method: 'Math.add', params: { a: 2, b: 3 }, id: 1 }));
    console.log(format.contentType, '→', res.headers['content-type'], '| bytes:', res.body!.length);
    console.log('  wire:', format.decode(res.body!)); // { jsonrpc: '2.0', id: 1, result: 5 }
  }

  // Ошибка валидации — нативный CoreError ядра → код -32602 в байтовом конверте.
  const binding = jsonrpcBytes(composer);
  const bad = await binding.handle(request(json, { jsonrpc: '2.0', method: 'Math.add', params: { a: 'x' }, id: 2 }));
  console.log('invalid params →', json.decode(bad.body!)); // error.code = -32602

  // fetch-адаптер: Request/Response работают с байтами нативно, без текстовизации.
  const binaryBinding = jsonrpcBytes(composer, { format: mockBinary });
  const fetchRequest = new Request('http://localhost/rpc', {
    method: 'POST',
    body: mockBinary.encode({ jsonrpc: '2.0', method: 'Math.add', params: { a: 10, b: 20 }, id: 3 }),
  });
  const response = await fromSvelteKit(binaryBinding, { request: fetchRequest });
  const bytes = new Uint8Array(await response.arrayBuffer());
  console.log('fetch Response:', response.status, response.headers.get('content-type'), '| bytes:', bytes.length);
  console.log('  wire:', mockBinary.decode(bytes)); // result: 30
})();