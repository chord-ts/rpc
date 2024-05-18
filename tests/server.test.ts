import { expect, test } from 'vitest';
import { composer } from '.';

test('Server handles list params', async () => {
  expect(
    await composer
      .exec({
        method: 'TestService.say',
        params: ['world']
      })
      .then((r) => r.result)
  ).toBe('Hello, world!');

  expect(
    await composer
      .exec({
        method: 'TestService.say',
        params: []
      })
      .then((r) => r.result)
  ).toBe('Hello, undefined!');

  expect(
    await composer
      .exec({
        method: 'TestService.sum',
        params: [2, 3]
      })
      .then((r) => r.result)
  ).toBe(5);

});

test('Server handles object params', async () => {
  expect(
    await composer
      .exec({
        method: 'TestService.say',
        params: {name: 'world'}
      })
      .then((r) => r.result)
  ).toBe('Hello, world!');

  expect(
    await composer
      .exec({
        method: 'TestService.say',
        params: {name2: 'world2'}
      })
      .then((r) => r.result)
  ).toBe('Hello, undefined!');

  expect(
    await composer
      .exec({
        method: 'TestService.sum',
        params: {a: 2, b: 3}
      })
      .then((r) => r.result)
  ).toBe(5);
});
