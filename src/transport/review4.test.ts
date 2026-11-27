// Регрессии раунда 4: formdata __proto__/повторяющиеся поля (#23), HEAD без тела (#22).

import { expect, test } from 'vitest';
import { z } from 'zod';
import { compose } from '../index';
import { get, post, rest } from '@/rest';
import { formdata } from '@/format';
import { fromSvelteKit } from '@/transport';

class Echo {
  static $echo = post('/echo', { body: z.record(z.string(), z.unknown()) });
  echo = Echo.$echo(async (input: Record<string, unknown>) => input);
}
class G {
  static $g = get('/g', {});
  g = G.$g(async () => ({ ok: true }));
}

test('#23: formdata __proto__ does not pollute or crash; repeated fields collect into an array', async () => {
  const fd = new FormData();
  fd.append('__proto__', 'evil');
  fd.append('tag', 'a');
  fd.append('tag', 'b');
  const binding = rest(compose({ Echo }), { format: formdata });
  const res = await fromSvelteKit(binding, {
    request: { method: 'POST', url: 'http://localhost/echo', text: async () => '', formData: async () => fd },
  });
  expect(res.status).toBe(200);
  const body = await res.formData();
  expect(body.getAll('tag')).toEqual(['a', 'b']);
  expect((Object.prototype as { evil?: unknown }).evil).toBeUndefined();
});

test('#22: HEAD to a GET route returns 200 with no body', async () => {
  const binding = rest(compose({ G }));
  const res = await fromSvelteKit(binding, {
    request: { method: 'HEAD', url: 'http://localhost/g', text: async () => '' },
  });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('');
});
