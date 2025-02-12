<script lang="ts">
  import {client} from '../../../../../../rpc/src/client'
	import type { Client } from './+server';

  export let data;

  const rpc = client<Client>({endpoint: '/redirectTest'})

  let res = '';
</script>


<button on:click={() => rpc.Crud.ping()}>Call redirect</button>