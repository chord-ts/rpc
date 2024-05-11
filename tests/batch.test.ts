import { expect, test } from 'vitest'

import {rpc} from '../src/'
import {getTestClient, TestService} from '.'


const RPC = getTestClient({
  TestService: new TestService()
})


test('Single batch works correctly"', async () => {
  expect(
    await RPC.batch(new RPC.TestService.say("world"))
  ).toStrictEqual(["Hello, world!"])
})

test('Batch call with multiple functions', async () => {
  const res = await RPC.batch(
    new RPC.TestService.say("world"), 
    new RPC.TestService.sum(1, 2)
  )
  expect(res).toStrictEqual(["Hello, world!", 3])
})

test('Handles batch with errors and works with config', async () => {
  const res = await RPC.config({onError: () => {}}).batch(
    new RPC.TestService.say("world"), 
    new RPC.TestService.sum(1, 2),
    new RPC.TestService.error()
  )

  await expect(res).toStrictEqual([ 'Hello, world!', 3, undefined ])
})
