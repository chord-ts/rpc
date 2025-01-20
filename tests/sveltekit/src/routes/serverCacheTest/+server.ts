import {json} from '@sveltejs/kit'

import { Composer, toRPC, rpc } from '../../../../../src/';
import { cacheMiddleware, sveltekitMiddleware } from '../../../../../src/middlewares';

class Service {
  @rpc()
  async hello(name: string) {
    await new Promise(r => setTimeout(r, 5000));
    const msg = `Hello ${name} ${new Date()}`
    return msg
  }

  @rpc()
  async hello2() {
    await new Promise(r => setTimeout(r, 2000));
    return 'hello from hello2'
  }
}

const composer = Composer.init({
  Service: new Service()
})

export type Client = typeof composer.clientType

let cache = {}
const cacheInterface = {
  async get(key) {
    console.log('cache get', key)
    return cache[key]
  },
  async set(key, val) {
    console.log('cache set', key, val)
    cache[key] = val
  }
}

composer.use(sveltekitMiddleware())
composer.use(cacheMiddleware(cacheInterface))

export async function POST(event) {
  return json(await composer.exec(event))
}