---
editUrl: false
next: true
prev: true
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
> • **key**: `PropKey`
>
> ### Returns
>
> `void`
>

## Source

[server.ts:439](https://github.com/chord-ts/rpc/blob/1be4c49/src/server.ts#L439)
