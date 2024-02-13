---
editUrl: false
next: true
prev: true
title: "cacheMiddleware"
---

> **cacheMiddleware**(`cache`, `ttl`?): `Middleware`

The `cacheMiddleware` function is a TypeScript function that returns a middleware function for
caching RPC method calls.

## Parameters

• **cache**: [`ICache`](../interfaces/ICache.md)

The `cache` parameter is an object that implements the `ICache` interface.
It is used to store and retrieve cached data.

• **ttl?**: `string` \| `number`

The `ttl` parameter stands for "time to live" and it determines how
long the cached data should be stored before it expires. It can be specified as a number
representing the time in milliseconds, or as a string representing a duration (e.g. "1h" for 1 hour,

## Returns

`Middleware`

The function `cacheMiddleware` returns a middleware function.

## Source

[middlewares/cache.ts:25](https://github.com/dmdin/chord/blob/8cccc00/src/middlewares/cache.ts#L25)
