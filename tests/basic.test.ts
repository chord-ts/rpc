import { expect, test } from 'vitest'

import {rpc} from '../src/'
import {getTestClient} from '.'

class TestService {

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

const RPC = getTestClient({
  TestService: new TestService()
})

test('Say "Hello, world!"', async () => {
  expect(await RPC.TestService.say("world")).toBe("Hello, world!")
})

test('Adds 1 + 2 to equal 3', async () => {
  expect(await RPC.TestService.sum(1, 2)).toBe(3)
})

test('Handles errors correctly', async () => {
  await expect(RPC.TestService.error()).rejects.toThrow("Error!")
  await expect(await RPC.TestService.error().catch(e => e.message)).toBe("Error!")
})

test('Creates instance of request with "new"', async () => {
  const req = new RPC.TestService.say("world")
  await expect(req).toStrictEqual({
    jsonrpc: '2.0',
    method: 'TestService.say',
    params: [ 'world' ],
    id: 1
  })
})