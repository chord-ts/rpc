<script lang="ts">
  import { RPC, Builder, client } from '../../../../../src/client';
  
  // import { client } from '@chord-ts/rpc/client';
  import { onMount } from 'svelte';
  import type { Client } from './+server';
  import { writable } from 'svelte/store';
  import { updated } from '$app/stores';

  const error = writable();

  const rpc = client<Client>({endpoint: '/baseTest'})

  onMount(async () =>{
    // console.log('call test', await rpc.TestRPC.dbReq(1))
    // console.log('batch test', rpc.batch)
    // console.log('cache', rpc.cache)
    // console.log('get', rpc.TestRPC)
    // console.log('get', rpc.TestRPC.dbReq)

    // console.log('simple', await rpc.TestRPC.dbReq(123))
    // console.log('construct test', new rpc.TestRPC.dbReq(123))
    // console.log('middleware test', rpc.TestRPC2.dbReq3(123))



    const batchRes = await rpc.batch(
      new rpc.TestRPC.dbReq(123),
      new rpc.TestRPC2.dbReq(321), 
      new rpc.TestRPC.dbReq2('123')
    )

    console.log(batchRes)
    const r = await rpc.TestRPC.dbReq2('123')
    const r1 = rpc.TestRPC.dbReq2('123')

    console.log(batchRes)

    })

  async function batchCall() {
    const batchRes = await rpc.batch(
      new rpc.TestRPC.dbReq(123),
      new rpc.TestRPC2.dbReq(321), 
      new rpc.TestRPC.dbReq2('123')
    )
    console.log('batchRes', batchRes)
  }
</script>

<h1 class="text-sm text-primary">Test Endpoint</h1>
<button class="btn btn-primary" >Hello</button>
<button class="btn btn-primary" on:click={batchCall}>Batch</button>
<span class="bg-error">{$error}</span>

{#if $updated}
  <p>Update happened</p>
{/if}