---
editUrl: false
next: true
prev: true
title: "dynamicClient"
---

> **dynamicClient**\<`T`\>(`params`?): [`Client`](../type-aliases/Client.md)\<`T`\>

The `dynamicClient` function is a TypeScript function that creates a dynamic client for making API
calls based on a provided endpoint and configuration.

## Type parameters

• **T**

## Parameters

• **params?**

The `params` parameter is an optional object that can contain two properties:

• **params\.config?**: [`ClientConfig`](../interfaces/ClientConfig.md)

• **params\.endpoint?**: `string`

## Returns

[`Client`](../type-aliases/Client.md)\<`T`\>

The function `dynamicClient` returns an instance of `Client<T>`.

## Source

[client.ts:138](https://github.com/chord-ts/rpc/blob/0637e5c/src/client.ts#L138)
