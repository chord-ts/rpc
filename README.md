<div id="header" align="center">
<img src="./docs/public/strings.png" alt="Strings"/>

# Chord - RPC Framework

The revolution in the world of client-server communication. Type-safe RPC on top of [JSON-RPC v2](https://www.jsonrpc.org/specification) protocol.

<a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=white"></a>
<a href="https://kit.svelte.dev/"><img src="https://img.shields.io/badge/SvelteKit-191919?style=for-the-badge&logo=svelte&logoColor=FF3E00"></a>
<a href="https://expressjs.com/"><img src="https://img.shields.io/badge/Express-69b74d?style=for-the-badge&logo=express&logoColor=white"></a>
<a href="https://www.jsonrpc.org/specification"><img src="https://img.shields.io/badge/JSONRPC-18181a?style=for-the-badge&logo=json&logoColor=white"></a>
</div>

<div align="center">
  <img alt="download stats" src="https://img.shields.io/npm/dm/@chord-ts/rpc?style=flat&color=218380">  
  <img alt="version" src="https://img.shields.io/npm/v/@chord-ts/rpc?style=flat&color=3F4CF8&label=latest">
  <img alt="license" src="https://img.shields.io/npm/l/@chord-ts/rpc?color=D81159">
  <img alt="maintainability" src="https://img.shields.io/codeclimate/maintainability/chord-ts/rpc?color=04E762">
</a>
</div>

<br>

<img alt="Repository Stats" src="https://repobeats.axiom.co/api/embed/64b5982f552f7d4a6b4abfc52c3251b8591f2da8.svg">

## ✅ Used inside

<div align="center">
  <a href="https://sbermarketing.ru">
  <img alt="SberMarketing" src="./docs/public/SBER_MARKETING_LOGO.png" alt="SberMarketing" width="200"/>
  </a>  
</div>

## 🥏 Why?

Because client-server communication becomes complex with the growth of project. Hundreds of __REST API__ endpoints destroy [Developer Experience](https://github.blog/2023-06-08-developer-experience-what-is-it-and-why-should-you-care/). On the other hand [GraphQL](https://graphql.org/) seems like a cumbersome and suboptimal solution, and [gRPC](https://grpc.io/) works only for server-to-server

That's where __Chord__ comes to solve accumulated problems of modern software development

## ✨ Features

* Protocol agnostic
* Framework agnostic
* Type safe exchange
* Accelerated development
* IDE hinting out-of-box
* Client size ~1.5kb

## ⚙️ Installation

**Chord** can be used with any backend library. Install it freely from [npm](https://www.npmjs.com/package/@chord-ts/rpc) via your favorite package manager

```bash
npm install @chord-ts/rpc
# or
pnpm install @chord-ts/rpc
```

**Chord** uses [decorators](https://www.typescriptlang.org/docs/handbook/decorators.html) and [reflection](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Reflect) under the hood, to construct server and client

So you need to configure your _tsconfig.json_ first

**`./tsconfig.json`**

```json5
{
  compilerOptions: {
    // Other stuff...

    target: 'ESNext',
    experimentalDecorators: true,
    emitDecoratorMetadata: true
  }
}
```

### ⚠️ Caveats

If you are using [Vite](https://vitejs.dev/) as bundler of your project, you have to note, that [ESbuild](https://esbuild.github.io/) that is used under the hood, [does not support](https://github.com/evanw/esbuild/issues/257) _emitDecoratorMetadata_ flag at the moment

Thus, you have to use additional plugins for [Vite](https://vitejs.dev/). I personally recommend to try out [SWC](https://www.npmjs.com/package/unplugin-swc). It fixes this issue and doesn't impact on rebuilding performance

Then add [SWC](https://www.npmjs.com/package/unplugin-swc) plugin to [Vite](https://vitejs.dev/):

**`./vite.config.ts`**

```javascript
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [sveltekit(), swc.vite()],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}']
  }
});
```

## 🛠️ Usage

The example below uses [SvelteKit](https://kit.svelte.dev/) framework, but you can try your own on any other preferred framework like [Next](https://nextjs.org/) or [Nuxt](https://nuxt.com/)

### 📝 Implement the Class

Then implement defined interface inside your controller. In [SvelteKit](https://kit.svelte.dev/) it's [+server.ts](https://kit.svelte.dev/docs/routing#server) file

**`./src/routes/+server.ts`**

```typescript
import { json } from '@sveltejs/kit';
import { Composer, rpc, type Composed } from '@chord-ts/rpc'; // Main components of Chord we will use
import { sveltekitMiddleware } from '@chord-ts/rpc/middlewares'; // Middleware to process RequestEvent object

// 1. Implement the class containing RPC methods
export class Say {
  @rpc() // Use decorator to register callable method
  hello(name: string): string {
    return `Hello, ${name}!`;
  }
}

// 2. Init Composer instance that will handle requests
export const composer = Composer.init({ Say: new Say() });

// 3. Create a type that will be used on frontend
export type Client = typeof composer.clientType;

composer.use(sveltekitMiddleware()); // Use middleware to process SvelteKit RequestEvent

// 4. SvelteKit syntax to define POST endpoint
export async function POST(event) {
  // Execute request in place and return result of execution
  return json(await composer.exec(event));
}
```

What we did in this listing is defined everything we need to handle requests. The first three steps are the same for any framework you will use, while the fourth is depended of it

You can implement a middleware for your backend framework which must extract body of request

### 🖼️ Use RPC on frontend

Now we are ready to call the method on frontend. As we use [SvelteKit](https://kit.svelte.dev/), we have a full power of [Svelte](https://svelte.dev/) for our UI

**`./src/routes/+page.svelte`**

```html
<script lang="ts">
  import { client } from '@chord-ts/rpc/client';
  import { onMount } from 'svelte';

  // Import our Contract
  import type { Client } from './+server';

  // Init dynamic client with type checking
  // Use Contract as Generic to get type safety and hints from IDE
  // dynamicClient means that RPC will be created during code execution
  // and executed when the function call statement is found
  const rpc = client<Client>({ endpoint: '/' });

  let res;
  // Called after Page mount. The same as useEffect(..., [])
  onMount(async () => {
    // Call method defined on backend with type-hinting
    res = await rpc.Say.hello('world');
    console.log(res);
  });
</script>

<h1>Chord call Test</h1>
<p>Result: {res}</p>
```

## 📦 Try it yourself

Ready to run sandbox with prepared environment for your experiments

<a href="https://www.sveltelab.dev/rkt1wa1z8trbcuc?files=.%2Fsrc%2Froutes%2F%2Bpage.svelte%2C.%2Fsrc%2Froutes%2F%2Bserver.ts" target="_blank"><img src="https://img.shields.io/badge/SvelteLab-191919?style=for-the-badge&logo=svelte&logoColor=FF3E00"></a>

## 📚 Further reading

We have finished a basic example of using **Chord**. But it's the tip of the iceberg of possibilities that framework unlocks

---

Visit the [Documentation](https://chord.vercel.app)(Coming Soon) to dive deeper
