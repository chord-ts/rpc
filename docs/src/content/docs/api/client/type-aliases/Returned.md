---
editUrl: false
next: true
prev: true
title: "Returned"
---

> **Returned**\<`T`\>: `Awaited`\<`ReturnType`\<`T`\>\>

Generic that simplifies extraction of returned type of function

## Param

The `functionType` parameter is of type `T`, which represents a function

## Example

```typescript
const fn = async (a: number, b: string) => a + b;
type Sum = Returned<typeof fn>; // string
```

## Type parameters

• **T** extends (...`args`) => `unknown`

## Source

[client.ts:263](https://github.com/chord-ts/rpc/blob/1be4c49/src/client.ts#L263)
