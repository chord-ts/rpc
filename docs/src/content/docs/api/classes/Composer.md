---
editUrl: false
next: true
prev: true
title: "Composer"
---

## Type parameters

• **T** extends `Object`

## Constructors

### new Composer(models, config)

> **new Composer**\<`T`\>(`models`, `config`?): [`Composer`](Composer.md)\<`T`\>

The constructor initializes a Composer instance with models and an optional configuration.
Should not be used, because TypeScript will not know about passed Service objects

#### Parameters

• **models**: `T`

The `models` parameter is of type `T`, which represents a generic type. It is
used to specify the models that will be injected into the Composer instance. The models are
expected to be an object where the keys are strings representing the model names, and the values
are the actual model classes.

• **config?**: [`ComposerConfig`](../interfaces/ComposerConfig.md)

The `config` parameter is an optional argument of type
`ComposerConfig`. It is used to provide configuration options for the Composer constructor.

#### Returns

[`Composer`](Composer.md)\<`T`\>

#### Source

[server.ts:42](https://github.com/chord-ts/rpc/blob/0637e5c/src/server.ts#L42)

## Properties

### methods

> **`static`** **methods**: `Map`\<`string`, [`MethodDescription`](../interfaces/MethodDescription.md)\>

#### Source

[server.ts:54](https://github.com/chord-ts/rpc/blob/0637e5c/src/server.ts#L54)

***

### props

> **`static`** **props**: `Map`\<`string`, [`PropertyDescription`](../interfaces/PropertyDescription.md)[]\>

#### Source

[server.ts:57](https://github.com/chord-ts/rpc/blob/0637e5c/src/server.ts#L57)

## Accessors

### clientType

> **`get`** **clientType**(): `T`

The function returns an empty object casted as a specific type. Use it only for generating a client type

#### Returns

`T`

The code is returning an empty object (`{}`) that has been typecasted to `unknown` and then
to `T`.

#### Source

[server.ts:132](https://github.com/chord-ts/rpc/blob/0637e5c/src/server.ts#L132)

## Methods

### exec()

> **exec**(`event`): `Promise`\<[`SomeResponse`](../type-aliases/SomeResponse.md) \| [`BatchResponse`](../type-aliases/BatchResponse.md)\>

The function `exec` processes an event by running middlewares, extracting the body from the event,
and executing procedures either individually or in batch.

#### Parameters

• **event**: `unknown`

The `event` parameter is of type `unknown`, which means it can be any
type of value. It is then casted to `Record<string, unknown>`, which represents an object with
string keys and unknown values.

#### Returns

`Promise`\<[`SomeResponse`](../type-aliases/SomeResponse.md) \| [`BatchResponse`](../type-aliases/BatchResponse.md)\>

The function `exec` returns a `Promise` that resolves to either a `SomeResponse` object
or a `BatchResponse` array.

#### Example

__SvelteKit example__
```typescript
export async function POST(event) {
 return json(await composer.exec(event));
}
```
 __Express example__
```typescript
const app = express()
app.use(express.json());

app.post('/', async (req, res) => {
 res.send(await composer.exec(req));
})
```

#### Source

[server.ts:204](https://github.com/chord-ts/rpc/blob/0637e5c/src/server.ts#L204)

***

### getSchema()

> **getSchema**(`route`?): [`Schema`](../interfaces/Schema.md)

The function `getSchema` returns a schema object containing information about methods, route, and
models.

#### Parameters

• **route?**: `string`

The `route` parameter is a string that represents the route for which the
schema is being generated. It is an optional parameter, meaning it can be omitted. If it is not
provided, the code checks if the `config` property exists and if it has a `route` property. If both

#### Returns

[`Schema`](../interfaces/Schema.md)

a Schema object.

#### Source

[server.ts:163](https://github.com/chord-ts/rpc/blob/0637e5c/src/server.ts#L163)

***

### use()

> **use**(`middleware`): `void`

The "use" function adds a middleware function to the list of middlewares.

#### Parameters

• **middleware**: [`Middleware`](../type-aliases/Middleware.md)

The `middleware` parameter is a function that acts as a middleware.
It is a function that takes three arguments: `req`, `res`, and `next`. The `req` argument represents
the request object, the `res` argument represents the response object, and the `next` argument is a 
callback that should be called to continue the execution of middlewares and procedures.

#### Returns

`void`

#### Example

```typescript
import { sveltekitMiddleware } from '@chord-ts/rpc/middlewares';
// ...
composer.use(sveltekitMiddleware())
```

#### Source

[server.ts:151](https://github.com/chord-ts/rpc/blob/0637e5c/src/server.ts#L151)

***

### addMethod()

> **`static`** **addMethod**(`desc`): `void`

The function `addMethod` adds a method description to a map called `Composer.methods`.

#### Parameters

• **desc**: [`MethodDescription`](../interfaces/MethodDescription.md)

The parameter `desc` is of type `MethodDescription`.

#### Returns

`void`

#### Source

[server.ts:91](https://github.com/chord-ts/rpc/blob/0637e5c/src/server.ts#L91)

***

### addProp()

> **`static`** **addProp**(`property`): `void`

The function `addProp` adds a property to a target object and stores it in a map.

#### Parameters

• **property**

• **property\.key**: [`PropKey`](../type-aliases/PropKey.md)

• **property\.target**: `object`

#### Returns

`void`

#### Source

[server.ts:100](https://github.com/chord-ts/rpc/blob/0637e5c/src/server.ts#L100)

***

### findRequestField()

> **`static`** **findRequestField**(`event`): `undefined` \| `Object`

The function `findRequestField` checks if an event object has a `body` and `method` property, and if
not, it checks if it has a `request` property and returns it.

#### Parameters

• **event**: `unknown`

The `event` parameter is of type `unknown`, which means it can be any type
of value. It is used to represent an event object that is passed to the `findRequestField` function.
The function checks if the `event` object has a `body` property and a `method
@returns The function `findRequestField` returns the `event` object if it has a `body` property and
a `method` property. If the `event` object does not have these properties, it checks if the `event`
object has a property named `request`. If it does, it returns the `request` property of the `event`
object.

#### Returns

`undefined` \| `Object`

#### Source

[server.ts:117](https://github.com/chord-ts/rpc/blob/0637e5c/src/server.ts#L117)

***

### init()

> **`static`** **init**\<`T`\>(`models`, `config`?): [`Composed`](../type-aliases/Composed.md)\<`T`\>

The `init` function initializes a Composer instance with the given models and configuration, and
returns a composed object.

#### Type parameters

• **T** extends `Object`

#### Parameters

• **models**: `T`

The `models` parameter is a generic type `T` that extends an object with string
keys and unknown values. It represents a collection of models that will be used by the Composer.

• **config?**: [`ComposerConfig`](../interfaces/ComposerConfig.md)

The `config` parameter is an optional object that represents the
configuration options for the Composer. It can contain various properties that customize the
behavior of the Composer.

#### Returns

[`Composed`](../type-aliases/Composed.md)\<`T`\>

The `init` function returns an instance of the `Composer` class, casted as `Composed<T>`.

#### Example

```typescript
export class Say {
 @rpc() // Use decorator to register callable method
 hello(name: string): string {
   return `Hello, ${name}!`;
 }
}

export const composer = Composer.init({ Say: new Say() });
```

#### Source

[server.ts:83](https://github.com/chord-ts/rpc/blob/0637e5c/src/server.ts#L83)
