import {json} from '@sveltejs/kit'

import { Composer, toRPC } from '../../../../../src/';
import { sveltekitMiddleware } from '../../../../../src/middlewares';

class Service {
  async hello(name: string) {
    await new Promise(r => setTimeout(r, 6000));
    const msg = `Hello ${name} ${new Date()}`
    return msg
  }

  async noParams() {
    await new Promise(r => setTimeout(r, 2000));
    return 'hello from noParams'
  }
}

const service = new Service()
const composer = Composer.init({
  Service: toRPC(service),
})

composer.use(sveltekitMiddleware())

export type Client = typeof composer.clientType
export async function POST(event) {
  return json(await composer.exec(event))
}