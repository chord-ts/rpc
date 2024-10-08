<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '../../../../../src';
	import type { Client } from './+server';
  import {jsonSchema} from './schema'

	const rpc = client<Client>({ endpoint: '/authTest' });
	let res1 = null
	let res2 = null
	onMount(async () => {
		res1 = await rpc.Service2.read();
		res2 = await rpc.Service2.list();

		console.log(res1, res2)
		console.log(await rpc.Service2.delete().catch(e => console.error(e)));
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
