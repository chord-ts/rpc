---
title: Quick start
description: Quick start for Chord
---


### 📦 Sandbox

The fastest way to try out __`Chord`__ is to open the [sandbox](https://www.sveltelab.dev/rkt1wa1z8trbcuc?files=.%2Fsrc%2Froutes%2F%2Bpage.svelte%2C.%2Fsrc%2Froutes%2F%2Bserver.ts), no installation required.

### 📲 Init project

If you are planning to use [SvelteKit](https://kit.svelte.dev/), just clone a ready to run [template](https://github.com/chord-ts/sveltekit-example)

```bash
git clone https://github.com/chord-ts/sveltekit-example
```

### 🦾 Manual install

**Chord** can be used with any backend library. Install it freely from [npm](https://www.npmjs.com/package/@chord-ts/rpc) via your favorite package manager

```bash
npm install @chord-ts/rpc
# or
pnpm install @chord-ts/rpc
```

**Chord** uses [decorators](https://www.typescriptlang.org/docs/handbook/decorators.html) and [reflection](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Reflect) under the hood, to construct server and client. So you need to configure your _tsconfig.json_ first

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

:::caution
If you are using [Vite](https://vitejs.dev/) as bundler of your project, you have to note, that [ESbuild](https://esbuild.github.io/) that is used under the hood, [does not support](https://github.com/evanw/esbuild/issues/257) _emitDecoratorMetadata_ flag at the moment
:::
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

