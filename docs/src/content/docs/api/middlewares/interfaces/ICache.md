---
editUrl: false
next: true
prev: true
title: "ICache"
---

## Methods

### get()

> **get**(`k`): `Promise`\<`unknown`\>

#### Parameters

• **k**: `string`

#### Returns

`Promise`\<`unknown`\>

#### Source

[middlewares/cache.ts:7](https://github.com/dmdin/chord/blob/8cccc00/src/middlewares/cache.ts#L7)

***

### set()

> **set**(`k`, `v`, `ttl`?): `Promise`\<`void`\>

#### Parameters

• **k**: `string`

• **v**: `unknown`

• **ttl?**: `string` \| `number`

#### Returns

`Promise`\<`void`\>

#### Source

[middlewares/cache.ts:8](https://github.com/dmdin/chord/blob/8cccc00/src/middlewares/cache.ts#L8)
