import {json} from '@sveltejs/kit'

import { Composer, toRPC, rpc, depends } from '../../../../../src/';
import { cacheMiddleware, sveltekitMiddleware } from '../../../../../src/middlewares';

class Service {
  @depends()
  ctx!: {user: string}

  @rpc()
  async hello() {
    const msg = `Hello ${this.ctx.user} ${new Date()}`
    return msg
  }
}

export const _composer = Composer.init({
  Service: new Service()
})

export type Client = typeof _composer.clientType


_composer.use(sveltekitMiddleware())

export async function POST(event) {
  return json(await _composer.exec(event))
}