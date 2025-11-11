<script lang="ts">
  import { RPC, Builder, client } from '../../../../../src/client';
  
  // import { client } from '@chord-ts/rpc/client';
  import { onMount } from 'svelte';
  import type { Client } from './+server';
  import { writable } from 'svelte/store';
  import { updated } from '$app/stores';

  const rpc = client<Client>({endpoint: '/autoInit'})

  let r1, r2
  onMount(async () =>{
    r1 = await rpc.TestRPC.dbReq2('123')
    r2 = await rpc.TestRPC.dbReq2('123')

  })

</script>

<h1 class="text-sm text-primary">Test Endpoint</h1>
{r1} {r2}
