---
editUrl: false
next: false
prev: false
title: "rpc"
---

> **rpc**(`config`?): (`target`, `key`, `descriptor`) => `void`

The `rpc` function is a TypeScript decorator that adds metadata and configuration options to Composer singleton.

⚠️ Decorator registers method using the class name of parent. That's why you have to specify the same name as key during Composer initialization

## Parameters

• **config?**: [`MethodConfig`](../interfaces/MethodConfig.md)

The `config` parameter is an optional object that contains
configuration options for the `rpc` function. It has the following properties:

## Returns

`Function`

The `rpc` function returns a new function that takes three arguments: `target`, `key`, and
`descriptor`.

> ### Parameters
>
> • **target**: [`Target`](../interfaces/Target.md)
>
> • **key**: [`PropKey`](../type-aliases/PropKey.md)
>
> • **descriptor**: `PropertyDescriptor`
>
> ### Returns
>
> `void`
>

## Example

```ts
export class Say {
 @rpc() // Use decorator to register callable method
 hello(name: string): string {
   return `Hello, ${name}!`;
 }
}
```

## Source

[server.ts:385](https://github.com/chord-ts/rpc/blob/d3d88c3/src/server.ts#L385)
