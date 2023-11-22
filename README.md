<div id="header" align="center">
<img src="./docs/public/strings.png" alt="Strings"/>

<h1>Chord - RPC Framework</h1>

The revolution in the world of client-server communication. Type-safe RPC communication on top of [JSON-RPC v2](https://www.jsonrpc.org/specification) protocol.

<a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=white"></a>
<a href="https://kit.svelte.dev/"><img src="https://img.shields.io/badge/SvelteKit-191919?style=for-the-badge&logo=svelte&logoColor=FF3E00"></a>
<a href="https://expressjs.com/"><img src="https://img.shields.io/badge/Express-69b74d?style=for-the-badge&logo=express&logoColor=white"></a>
<a href="https://www.jsonrpc.org/specification"><img src="https://img.shields.io/badge/JSONRPC-18181a?style=for-the-badge&logo=json&logoColor=white"></a>
</div>

## ⚙️ Installation

Chord is framework agnostic and can be used with any backend library. Install it freely from __npm__ via your favorite package manager.

```bash
npm install dialute
# or
pnpm install dialute
```

Chord uses [decorators](https://www.typescriptlang.org/docs/handbook/decorators.html) and [reflection](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Reflect) under the hood, to construct server and client.

So you need to configure your _tsconfig.json_ first.

#### **`./tsconfig.ts`**

```json
{
  "compilerOptions": {
    // Other stuff...

    "target": "ESNext",    
    "experimentalDecorators": true,  
    "emitDecoratorMetadata": true,         
  }
}
```

#### ⚠️ Caveats

If you are using [Vite](https://vitejs.dev/) as bundler of your project, you have to note, that [ESbuild](https://esbuild.github.io/) that is used under the hood, [does not support](https://github.com/evanw/esbuild/issues/257) _emitDecoratorMetadata_ flag at the moment.

Thus, you have to use additional plugins for Vite. I personally recommend to try out [SWC](https://www.npmjs.com/package/unplugin-swc). It fixes this issue and doesn't impact on rebuilding performance.
