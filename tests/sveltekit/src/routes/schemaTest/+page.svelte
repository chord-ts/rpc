<script lang="ts">
	import { onMount } from 'svelte';
	import { client, type Returned } from '../../../../../src/';
	import type { Client } from './+server';
  import {jsonSchema} from './schema'

	const rpc = client<Client>({ endpoint: '/schemaTest' });
	let res1 = null
	let res2 = null
	onMount(async () => {
		res1 = await rpc.Serv.hello('world', 5);
		res2 = await rpc.Serv.multipleArgs({name: "Dima", secondName: "Din"})
	})
	
	// let res2 = rpc.Service.hello
	
</script>

<div>
	<p>
		{#if !res1}
			Loading...
		{:else }
			Hello: {res1}
		{/if}
	</p>
	<!-- <p>
		{#await res2}
			Loading...
		{:then r}
			noParams: {r}
		{/await}
	</p> -->
  <p>
    {JSON.stringify(jsonSchema, null, 2)}
  </p>
</div>

<style>
	div {
		display: flex;
		flex-direction: column;
	}
</style>
