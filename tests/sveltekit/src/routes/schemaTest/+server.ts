import {json} from '@sveltejs/kit'

import { Composer, rpc, val} from '../../../../../src/';
import { SchemaGenerator } from '../../../../../src/schema';
import { sveltekitMiddleware } from '../../../../../src/middlewares';
import {z} from 'zod'


class Service {
  
  static string = z.string()

  // @rpc({in: [Service.string], out: Service.string})
  @rpc()
  async hello(@val(Service.string) name: string) {
    const msg = `Hello ${name} ${new Date()}`
    return msg
  }

  // @rpc({in: [Service.string, Service.string], out: Service.string})
  @rpc()
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
  Serv: new Service()
})

const schema = new SchemaGenerator()
// console.log(schema.render())

composer.use(sveltekitMiddleware())

export type Client = typeof composer.clientType

export async function POST(event) {
  console.log(composer)
  return json(await composer.exec(event))
}
