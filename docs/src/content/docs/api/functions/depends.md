---
editUrl: false
next: false
prev: false
title: "depends"
---

> **depends**(): (`target`, `key`) => `void`

The `depends` function is used for dependency injection in TypeScript, specifically for injecting
the `ctx` property.

## Returns

`Function`

The function `depends()` returns another function.

> ### Parameters
>
> • **target**: `object`
>
> • **key**: [`PropKey`](../type-aliases/PropKey.md)
>
> ### Returns
>
> `void`
>

## Source

[server.ts:414](https://github.com/chord-ts/rpc/blob/d3d88c3/src/server.ts#L414)
