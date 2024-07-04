import {json} from '@sveltejs/kit'

import { Composer, rpc, val} from '../../../../../src/';
import { ZodAdapter } from '../../../../../src/validators';
import { SchemaGenerator } from '../../../../../src/schema';
import { sveltekitMiddleware } from '../../../../../src/middlewares';
import {z} from 'zod'


const string = z.string()
const number = z.number()

const fio = z.object({
  name: z.string(),
  secondName: z.string()
})

type FIO = z.infer<typeof fio>
class Service {
  


  // @rpc({in: [Service.string], out: Service.string})
  @rpc()
  async hello(@val(string) name: string, @val(number) n: number) {
    const msg = `Hello ${name} ${new Date()} ${n}`
    return msg
  }

  // @rpc({in: [Service.string, Service.string], out: Service.string})
  @rpc()
  async multipleArgs(@val(fio) fio: FIO) {
    const msg = `Hello ${fio.name} ${fio.secondName} ${new Date()}`
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
}, {
  validator: ZodAdapter
})

// const schema = new SchemaGenerator()
// console.log(schema.render())

composer.use(sveltekitMiddleware())

export type Client = typeof composer.clientType

export async function POST(event) {
  return json(await composer.exec(event))
}
