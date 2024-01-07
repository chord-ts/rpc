<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '../../../../../src/';
	import type { Client } from './+server';

	const rpc = client<Client>({ endpoint: '/cacheTest' });

	let res1 = rpc.Service.hello.cache({expiry: 1000 * 30, update: true})('world');
	let res2 = rpc.Service.noParams.cache()();
</script>

<div>
	<p>
		{#await res1}
			Loading...
		{:then r}
			Hello: {r}
		{/await}
	</p>
	<p>
		{#await res2}
			Loading...
		{:then r}
			noParams: {r}
		{/await}
	</p>
</div>

<style>
	div {
		display: flex;
		flex-direction: column;
	}
</style>
