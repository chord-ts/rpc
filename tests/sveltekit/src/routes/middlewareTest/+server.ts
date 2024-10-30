import {json} from '@sveltejs/kit'

import { Composer, rpc, } from '../../../../../src/';
import { SchemaGenerator } from '../../../../../src/schema';
import { sveltekitMiddleware } from '../../../../../src/middlewares';

class Service {
  

  @rpc({use: [methodMw, methodMw2]})
  async hello(name: string) {
    const msg = `Hello ${name}`
    return msg
  }

  @rpc()
  async multipleArgs(name: string, secondName: string) {
    const msg = `Hello ${name} ${secondName}`
    return msg
  }

  @rpc()
  async noParams() {
    return 'hello from noParams'
  }
}

async function methodMw(event, ctx, next) {
  console.log('method mw')
  // throw new Error('mw error')
  next()
}

async function methodMw2(event, ctx, next) {
  console.log('method mw2')
  // throw new Error('mw2 error')

  next()
}



async function composerMw(event, ctx, next) {
  // console.log('composer mw', event, ctx)
  next()
}

const composer = Composer.init({
  Service: new Service()
})

composer.use(sveltekitMiddleware())
composer.use(composerMw)

export type Client = typeof composer.clientType

export async function POST(event) {
  return json(await composer.exec(event))
}