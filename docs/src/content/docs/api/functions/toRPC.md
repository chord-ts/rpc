---
editUrl: false
next: false
prev: false
title: "toRPC"
---

> **toRPC**\<`T`\>(`instance`): `T`

The `toRPC` function takes an object instance and adds all its methods to a Composer object.

## Type parameters

• **T** extends `object`

## Parameters

• **instance**: `T`

The `instance` parameter is the object that you want to convert to an RPC
(Remote Procedure Call) object. It should be an instance of a class or an object that has methods
that you want to expose as RPC methods.

## Returns

`T`

The `toRPC` function returns the `instance` object that was passed as an argument. 
It should be used during Composer initialization

## Example

```ts
class MyService {
  doSomething() {
    return 'Hello World';
  }
}

const service = new MyService();
const composer = Composer.init({
 MyService: toRPC(service)
})
```

## Source

[server.ts:343](https://github.com/chord-ts/rpc/blob/d3d88c3/src/server.ts#L343)
