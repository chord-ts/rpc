<script lang="ts">
	import { onMount } from 'svelte';
	import { client, type Returned } from '../../../../../src/';
	import type { Client } from './+server';

	const rpc = client<Client>({ endpoint: '/cacheTest' });

	// onMount()
	// let res1: Promise<Returned<typeof rpc.Service.hello>> = 
	// 	rpc.Service.hello.cache({
	// 	expiry: 1000 * 30,
	// 	mode: 'update',
	// 	onInvalidate: (res) => (res1 = res)
	// })('world');
	

	let res1: Promise<string> = rpc.cache(
		{
		expiry: 1000 * 30,
		mode: 'update',
		onInvalidate: (res) => (res1 = res)
	}).Service.hello('name')
	let res2 = rpc.cache().Service.noParams();
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
