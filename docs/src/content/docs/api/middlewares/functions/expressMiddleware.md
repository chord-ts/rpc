---
editUrl: false
next: true
prev: true
title: "expressMiddleware"
---

> **expressMiddleware**(): `Middleware`

The `expressMiddleware` function is a TypeScript function that creates an Express middleware that
sets the `ctx.body` property to the `event.body` value and calls the `next` function.

## Returns

`Middleware`

A middleware function that will handle request event and extract body.

## Example

```typescript
import expressMiddleware from '@chord-ts/rpc/middlewares';
// ...
composer.use(expressMiddleware());
```

## Source

[middlewares/express.ts:14](https://github.com/chord-ts/rpc/blob/1be4c49/src/middlewares/express.ts#L14)
