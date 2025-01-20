<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '../../../../../src/';
	import type { Client } from './+server';

	const rpc = client<Client>({ endpoint: '/serverCacheTest' });
	let res1, res2
	onMount(async () => {
		res1 = await rpc.Service.hello('name')
		res2 = await rpc.Service.hello2();  
  })
	// let res1: Promise<Returned<typeof rpc.Service.hello>> = 
	// 	rpc.Service.hello.cache({
	// 	expiry: 1000 * 30,
	// 	mode: 'update',
	// 	onInvalidate: (res) => (res1 = res)
	// })('world');
	

	
</script>

<div>
	<p>
		{#if res1}
      hello: {res1}
		{/if}
	</p>
	<p>
		{#if res2}
      hello2: {res2}
		{/if}
	</p>
</div>

<style>
	div {
		display: flex;
		flex-direction: column;
	}
</style>
