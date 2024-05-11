import { expect, test } from 'vitest'

import {rpc} from '../src/'
import {getTestClient, TestService} from '.'

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