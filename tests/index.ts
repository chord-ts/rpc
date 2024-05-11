import type { Transport, FailedResponse, ErrorCallback } from "../src";
import {client, Composer, rpc} from '../src'


export class TestService {

  // @ts-expect-error
  @rpc()
  async say(name: string) {
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
  
}

export function getTestClient<T>(models: T) {


  const testErrorCallback: ErrorCallback = async (e, { method, params }) => {  };

  // @ts-expect-error
  const composer = Composer.init(models, {
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
  return client<typeof composer.clientType>({endpoint: '/', config: {
    transport: testTransport, 
    onError: testErrorClient
  }})
}

