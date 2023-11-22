---
editUrl: false
next: false
prev: false
title: "Composer"
---

## Type parameters

▪ **T** extends `object`

## Constructors

### new Composer(models, config)

> **new Composer**\<`T`\>(`models`, `config`?): [`Composer`](/api/classes/composer/)\<`T`\>

#### Parameters

▪ **models**: `T`

▪ **config?**: [`ComposerConfig`](/api/interfaces/composerconfig/)

#### Returns

[`Composer`](/api/classes/composer/)\<`T`\>

#### Source

[server.ts:29](https://github.com/dmdin/chord/blob/5f43e0e/src/server.ts#L29)

## Properties

### methods

> **`static`** **methods**: `Map`\<`string`, [`MethodDescription`](/api/interfaces/methoddescription/)\>

#### Source

[server.ts:41](https://github.com/dmdin/chord/blob/5f43e0e/src/server.ts#L41)

***

### props

> **`static`** **props**: `Map`\<`string`, [`PropertyDescription`](/api/interfaces/propertydescription/)[]\>

#### Source

[server.ts:44](https://github.com/dmdin/chord/blob/5f43e0e/src/server.ts#L44)

## Methods

### exec()

> **exec**(`event`): `Promise`\<[`SomeResponse`](/api/type-aliases/someresponse/) \| [`BatchResponse`](/api/type-aliases/batchresponse/)\>

#### Parameters

▪ **event**: `unknown`

#### Returns

`Promise`\<[`SomeResponse`](/api/type-aliases/someresponse/) \| [`BatchResponse`](/api/type-aliases/batchresponse/)\>

#### Source

[server.ts:87](https://github.com/dmdin/chord/blob/5f43e0e/src/server.ts#L87)

***

### getSchema()

> **getSchema**(`route`?): [`Schema`](/api/interfaces/schema/)

#### Parameters

▪ **route?**: `string`

#### Returns

[`Schema`](/api/interfaces/schema/)

#### Source

[server.ts:71](https://github.com/dmdin/chord/blob/5f43e0e/src/server.ts#L71)

***

### use()

> **use**(`middleware`): `void`

#### Parameters

▪ **middleware**: [`Middleware`](/api/type-aliases/middleware/)

#### Returns

`void`

#### Source

[server.ts:67](https://github.com/dmdin/chord/blob/5f43e0e/src/server.ts#L67)

***

### addMethod()

> **`static`** **addMethod**(`__namedParameters`): `void`

#### Parameters

▪ **\_\_namedParameters**: [`MethodDescription`](/api/interfaces/methoddescription/)

#### Returns

`void`

#### Source

[server.ts:46](https://github.com/dmdin/chord/blob/5f43e0e/src/server.ts#L46)

***

### addProp()

> **`static`** **addProp**(`__namedParameters`): `void`

#### Parameters

▪ **\_\_namedParameters**: `object`

▪ **\_\_namedParameters.key**: [`PropKey`](/api/type-aliases/propkey/)

▪ **\_\_namedParameters.target**: `object`

#### Returns

`void`

#### Source

[server.ts:51](https://github.com/dmdin/chord/blob/5f43e0e/src/server.ts#L51)

***

### findRequestField()

> **`static`** **findRequestField**(`event`): `undefined` \| `object`

#### Parameters

▪ **event**: `unknown`

#### Returns

`undefined` \| `object`

#### Source

[server.ts:57](https://github.com/dmdin/chord/blob/5f43e0e/src/server.ts#L57)

***

Generated using [typedoc-plugin-markdown](https://www.npmjs.com/package/typedoc-plugin-markdown) and [TypeDoc](https://typedoc.org/)
