import { json } from '@sveltejs/kit';
import { Composer, rpc, depends } from 'chord-rpc';
import cache from 'chord-rpc/middlewares/cache';
import sveltekit from 'chord-rpc/middlewares/sveltekit';

// THIS IS CONTROLLER

interface Context {
  sb: unknown;
}

class TestRPC {
  @depends()
  private readonly ctx!: Context;

  @rpc()
  dbReq(param: number): string {
    // console.log('!ctx injected ', this.rpc2);
    // console.log('ctx injected ', this.ctx);
    // throw Error('Произошла ошибка!')
    return `Hello from TestRPC, ${param}`;
  }
  @rpc()
  dbReq2(param: string): string {
    return `Hello dbReq2, ${param}`;
  }
}


// function testMode() {
//   return async function h(event, ctx, next) {
//     console.log(event, ctx, )
//     return buildResponse({request: event.raw, result: 'hello!!!!'})
//   }
// }

const testCache = {
  async get(k) {throw TypeError('hh'); return "Cached hello"},
  async set(k, v, ttl) { console.log('set', k, v, ttl)}
}


class TestRPC2 {

  @rpc({ use: [cache(testCache)]})
  dbReq(param: number): string {
    return `Hello from TestRPC2, ${param}!`;
  }
  
  @rpc()
  dbReq3(param: string, param2: number): string {
    return `Hello from TestRPC2 dbReq3, ${param} ${param2}!`;
  }
}

const composer = Composer.init({ TestRPC: new TestRPC(), TestRPC2: new TestRPC2() })
composer.use(sveltekit());

export type Wrap = typeof composer.clientType;

export async function POST(event) {
  return json(await composer.exec(event));
}
