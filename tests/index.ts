import type { Transport, ErrorCallback, IRPC } from "../src/client/types";
import type { Composed } from "../src/server/types";
import {Builder, client, Composer, rpc} from '../src'


export class TestService {

  // @ts-expect-error
  @rpc()
  async say(name: string) {
    console.error('hello name', name)
    return `Hello, ${name}!`
  }

  // @ts-expect-error
  @rpc()
  async sum(a: number, b: number) {
    return a + b
  }

  // @ts-expect-error
  @rpc()
  async error() {
    throw new Error("Error!")
  }

  @rpc()
  async notify() {
    let a = 1
  }
}

export function getTestClient<T extends {[k: string]: unknown}>(models: T): [IRPC.Builder<T>, Composed<T> ] {


  const testErrorCallback: ErrorCallback = async (e, { method, params }) => {  };

  const composer = Composer.init<T>(models, {
    onError: testErrorCallback
  })


  composer.use(async (e, ctx, next) => {
    ctx.body = e
    next()
  })
  const testTransport: Transport = async ({ route, body }, opt) => {
    const res = await composer.exec(body).catch(e => console.log(e))
    return res
  };

  const testErrorClient = (e) => {throw new Error(e.message)}
  return [client<typeof composer.clientType>({endpoint: '/', config: {
    transport: testTransport, 
    onError: testErrorClient
  }}), composer]
}


export const [RPC, composer] = getTestClient({
  TestService: new TestService()
})
