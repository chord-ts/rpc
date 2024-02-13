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

[client.ts:237](https://github.com/dmdin/chord/blob/8cccc00/src/client.ts#L237)
