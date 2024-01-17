import {json} from '@sveltejs/kit'

import { Composer, rpc, SchemaGenerator } from '../../../../../src/';
import { sveltekitMiddleware } from '../../../../../src/middlewares';
import {z} from 'zod'




class Service {
  
  static string = z.string()

  @rpc({in: [Service.string], out: Service.string})
  async hello(name: z.infer<typeof Service.string>) {
    const msg = `Hello ${name} ${new Date()}`
    return msg
  }

  @rpc({in: [Service.string, Service.string], out: Service.string})
  async multipleArgs(name: z.infer<typeof Service.string>, secondName: z.infer<typeof Service.string>) {
    const msg = `Hello ${name} ${secondName} ${new Date()}`
    return msg
  }

  @rpc()
  async noParams() {
    return 'hello from noParams'
  }

  @rpc()
  async getSchema() {

  }
}

const composer = Composer.init({
  Service: new Service()
})

const schema = new SchemaGenerator()
console.log(schema.render())

composer.use(sveltekitMiddleware())

export type Client = typeof composer.clientType

export async function POST(event) {
  return json(await composer.exec(event))
}