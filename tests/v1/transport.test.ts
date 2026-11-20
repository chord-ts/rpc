import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultTransport } from '../../src/v1/client/defaults';

// Обработка HTTP-статусов v1-транспортом: редирект → навигация браузера; error-статус → сырая
// страница ошибки с предпросмотром в лог, упаковка в ошибку БЕЗ JSON-парсинга; успех → JSON-RPC парс.
const format = { parse: (r: Response) => r.json(), stringify: (v: unknown) => JSON.stringify(v) };
const call = (): Promise<any> => defaultTransport({ route: '/rpc', body: {}, format }) as Promise<any>;
const json = (obj: unknown, status = 200, statusText = '') =>
  new Response(JSON.stringify(obj), { status, statusText, headers: { 'content-type': 'application/json' } });
const redirected = (url: string) => {
  const r = new Response('', { status: 200 });
  Object.defineProperty(r, 'redirected', { value: true });
  Object.defineProperty(r, 'url', { value: url });
  return r;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('v1 defaultTransport status handling', () => {
  it('2xx JSON-RPC result passes through', async () => {
    vi.stubGlobal('fetch', async () => json({ jsonrpc: '2.0', result: 5, id: 1 }));
    expect((await call()).result).toBe(5);
  });

  it('2xx JSON-RPC error in body parsed normally', async () => {
    vi.stubGlobal('fetch', async () => json({ jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id: 1 }));
    expect((await call()).error.code).toBe(-32601);
  });

  it('redirect navigates browser via location.assign', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    vi.stubGlobal('fetch', async () => redirected('http://localhost/v1/redirectTest/in'));
    const res = await call();
    expect(assign).toHaveBeenCalledWith('http://localhost/v1/redirectTest/in');
    expect(res.error.data.redirected).toBe(true);
  });

  it('redirect without location (SSR) surfaced as error', async () => {
    vi.stubGlobal('fetch', async () => redirected('http://localhost/in'));
    const res = await call();
    expect(res.error.data.location).toBe('http://localhost/in');
    expect(res.error.message).toContain('Redirected');
  });

  it('non-2xx wrapped as status error WITHOUT JSON parse + log preview', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => json({ jsonrpc: '2.0', error: { code: -32602, message: 'Invalid params' } }, 400, 'Bad Request'));
    const res = await call();
    expect(res.error.code).toBe(400);
    expect(res.error.message).toBe('Bad Request');
    expect(res.error.data.body).toContain('-32602'); // сырой текст, не разобранный JSON-RPC error
    expect(spy.mock.calls[0][0]).toContain('HTTP 400');
  });

  it('non-JSON error page wrapped raw + trimmed preview and headers logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => new Response('<html><body>error page</body></html>', { status: 500, statusText: 'Internal Server Error', headers: { 'content-type': 'text/html' } }));
    const res = await call();
    expect(res.error.code).toBe(500);
    expect(res.error.message).toBe('Internal Server Error');
    expect(res.error.data.body).toBe('<html><body>error page</body></html>'); // сырое тело в data
    expect(res.error.data.headers['content-type']).toContain('text/html');
    const logged = spy.mock.calls[0][0];
    expect(logged).toContain('HTTP 500');
    expect(logged).toContain('headers:');
    expect(logged).toContain('preview: error page'); // trim без тегов
    expect(logged).not.toContain('<html>');
  });

  it('network failure surfaced as error', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    expect((await call()).error.message).toBe('Failed to fetch');
  });
});