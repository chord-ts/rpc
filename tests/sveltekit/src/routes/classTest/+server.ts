import {json} from '@sveltejs/kit'
import { Logger, type ILogObj } from "tslog";

import { Composer, toRPC } from '../../../../../src/';
import { sveltekitMiddleware } from '../../../../../src/middlewares';
const logger = new Logger<ILogObj>({ name: "server", type: "pretty", });

class Service {
  async hello(name: string) {
    const msg = `Hello ${name}`
    logger.info(msg)
    return msg
  }
}

const service = new Service()
const composer = Composer.init({
  Service: toRPC(service),
  Logger: toRPC(logger) 
})

composer.use(sveltekitMiddleware())

export type Client = typeof composer.clientType
export async function POST(event) {
  return json(await composer.exec(event))
}