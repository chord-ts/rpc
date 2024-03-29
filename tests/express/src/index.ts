import express from 'express'

import { Composer, rpc, depends, type Composed, buildResponse } from '@chord-ts/rpc';
import {expressMiddleware} from '@chord-ts/rpc/middlewares';

import type { ITestRPC, ITestRPC2, Wrapped} from './types'


interface Context {
  sb: unknown;
}

class TestRPC implements ITestRPC {
  @depends()
  private readonly ctx!: Context;

  @rpc()
  dbReq(param: number): string {
    // console.log('!ctx injected ', this.rpc2);
    // console.log('ctx injected ', this.ctx);
    throw Error('Произошла ошибка!')
    return `Hello from TestRPC, ${param}`;
  }
  @rpc()
  dbReq2(param: string): string {
    return `Hello dbReq2, ${param}`;
  }
}


function testMode() {
  return async function h(event, ctx, next) {
    console.log(event.raw)
    return buildResponse({request: event.raw, result: 'hello!!!!'})
  }
}

class TestRPC2 implements ITestRPC2 {

  @rpc({ use: [testMode()]})
  dbReq(param: number): string {
    return `Hello from TestRPC2, ${param}!`;
  }
  @rpc()
  dbReq3(param: string, param2: number): string {
    return `Hello from TestRPC2 dbReq3, ${param} ${param2}!`;
  }
}

export const composer = new Composer(
  { TestRPC, TestRPC2 },
  {
    route: '/test',
    onError: async (e, body) => console.log('hello error', body)
  }
) as unknown as Composed<Wrapped>;

composer.use(expressMiddleware());

const app = express()
app.use(express.json());

app.post('/', async (req, res) => {
  res.send(await composer.exec(req));
})

app.get('/', async (req, res) => {  
  res.send(await composer.getSchema());
})


const port = 3000
app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});