---
editUrl: false
next: true
prev: true
title: "dynamicClient"
---

> **dynamicClient**\<`T`\>(`params`?): `Client`\<`T`\>

The `dynamicClient` function is a _TypeScript_ function that creates a dynamic client for making API
calls based on a provided endpoint and configuration.

## Type parameters

• **T**

## Parameters

• **params?**: [`ClientParams`](../type-aliases/ClientParams.md)

The `params` parameter is an optional object that can contain two properties:

## Returns

`Client`\<`T`\>

The function `dynamicClient` returns an instance of `Client<T>`.

## Source

[client.ts:166](https://github.com/dmdin/chord/blob/8cccc00/src/client.ts#L166)
