<script lang="ts">
  import { dynamicClient, schemaClient,  } from '../../../../../src/client';
  import { onMount } from 'svelte';
  import type { Wrapped, Unwrapped } from './types';
  import type { Wrap } from './+server';
  import { writable } from 'svelte/store';

  export let data;

  const error = writable();

  // function catchError(e, m) {
  //   $error = e.message;
  // }

  onMount(async () => {
    // const rpc = schemaClient<Wrapped>(schema, );
    const rpc = dynamicClient<Wrap>()
    // console.log(rpc.TestRPC.dbReq.batch(123))
    // console.log('TestRPC2', await rpc.TestRPC2.dbReq(123));
    console.log('TestRPC', await rpc.TestRPC.dbReq(123));
    
    // const batchRes = await rpc.batch(
    //   rpc.TestRPC.dbReq.batch(123),
    //   rpc.TestRPC2.dbReq.batch(123), 
    //   rpc.TestRPC.dbReq2.batch('123')
    // ); // Batch запрос
    // console.log(batchRes)
    // console.log('onmount rpc=', await rpc.TestRPC.dbReq(123))
    
  });
</script>

<h1 class="text-sm text-primary">Test Endpoint</h1>
<button class="btn btn-primary">Hello</button>
<span class="bg-error">{$error}</span>
