---
editUrl: false
next: true
prev: true
title: "rpc"
---

> **rpc**(`config`?): (`target`, `key`, `descriptor`) => `void`

The `rpc` function is a TypeScript decorator that adds metadata and configuration options to Composer singleton.

:::caution
Decorator registers method using the class name of parent. That's why you have to specify the same name as key during Composer initialization
:::

## Parameters

• **config?**: `MethodConfig`

The `config` parameter is an optional object that contains
configuration options for the `rpc` function. It has the following properties:

## Returns

`Function`

The `rpc` function returns a new function that takes three arguments: `target`, `key`, and
`descriptor`.

> ### Parameters
>
> • **target**: `Target`
>
> • **key**: `PropKey`
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

[server.ts:410](https://github.com/dmdin/chord/blob/8cccc00/src/server.ts#L410)
