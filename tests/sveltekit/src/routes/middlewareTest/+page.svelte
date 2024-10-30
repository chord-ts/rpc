<script lang="ts">
	import { onMount } from 'svelte';
	import { client, type Returned } from '../../../../../src/';
	import type { Client } from './+server';

	const rpc = client<Client>({ endpoint: '/middlewareTest' });

	let res1
	onMount(async () => {
		res1 = await rpc.Service.hello('world').catch(e => console.log(e.data, e.message));
	})
	
</script>

<div>
	<p>
		{#if !res1}
			Loading...
		{:else }
			Hello: {res1}
		{/if}
	</p>
</div>

<style>
	div {
		display: flex;
		flex-direction: column;
	}
</style>
