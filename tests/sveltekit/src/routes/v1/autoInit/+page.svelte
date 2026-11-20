<script lang="ts">
  import { RPC, Builder, client } from '@chord/rpc/client';
  
  // import { client } from '@chord-ts/rpc/client';
  import { onMount } from 'svelte';
  import type { Client } from './+server';


  const rpc = client<Client>({endpoint: '/v1/autoInit'})

  let r1, r2
  onMount(async () =>{
    r1 = await rpc.TestRPC.dbReq2('123')
    r2 = await rpc.TestRPC.dbReq2('123')

  })

</script>

<h1 class="text-sm text-primary">Test Endpoint</h1>
{r1} {r2}
