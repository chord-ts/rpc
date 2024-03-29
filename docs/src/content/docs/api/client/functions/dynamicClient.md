---
editUrl: false
next: true
prev: true
title: "dynamicClient"
---

> **dynamicClient**\<`T`\>(`params`?): `Client`\<`T`\>

The `dynamicClient` function is a _TypeScript_ function that creates a dynamic client for making API
calls based on a provided endpoint and configuration.

:::caution[Deprecated]
It's better to use `client`, because `dynamicClient` will be removed in future
:::

## Type parameters

• **T**

The type describes `Services`. We have to import it from the server-side code. It's valid import, because it's not a value

## Parameters

• **params?**: [`ClientParams`](../type-aliases/ClientParams.md)

The `params` parameter is an optional object that can contain two properties. 
`endpoint` - is a path for endpoint that handles JSON-RPC calls with POST method

## Returns

`Client`\<`T`\>

The function `dynamicClient` returns an instance of `Client<T>`.

## Example

```typescript
// +server.ts
export type Client = typeof composer.clientType

// +page.svelte
// client and dynamicClient are the same
import { dynamicClient } from '@chord-ts/rpc/client';
import type { Client } from './+server';

const rpc = client<Client>({ endpoint: '/<path to endpoint>' });
```

## Source

[client.ts:181](https://github.com/chord-ts/rpc/blob/1be4c49/src/client.ts#L181)
