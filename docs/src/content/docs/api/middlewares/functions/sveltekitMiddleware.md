---
editUrl: false
next: true
prev: true
title: "sveltekitMiddleware"
---

> **sveltekitMiddleware**(): `Middleware`

The `sveltekitMiddleware` function is a middleware for SvelteKit that extracts JSON data from the
request and assigns it to the `ctx.body` property, while also merging the `event.locals` object into
the `ctx` object.

## Returns

`Middleware`

A middleware function that will handle request event and extract body.

## Example

```ts
import { sveltekitMiddleware } from '@chord-ts/rpc/middlewares'
// ...
composer.use(sveltekitMiddleware());
```

## Source

[middlewares/sveltekit.ts:16](https://github.com/chord-ts/rpc/blob/1be4c49/src/middlewares/sveltekit.ts#L16)
