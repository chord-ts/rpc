<script lang="ts">
  import {client} from '@chord/rpc/client'
	import type { Client } from './+server';

  export let data;

  const rpc = client<Client>({endpoint: '/v1/redirectTest'})

  let res = '';
</script>


<button on:click={() => rpc.Crud.ping()}>Call redirect</button>