<script lang="ts">
	import { onMount } from 'svelte';
	import { client, type Returned } from '@chord-ts/rpc/client';
	import type { Client } from './+server';

	const rpc = client<Client>({ endpoint: '/abortTest' });

	const c = new AbortController();
	const res = rpc.Service.hello
    .opt({signal: c.signal})('name');
</script>

<div>
	{#await res}
		<p>Loading</p>
	{:then r}
		<p>{r}</p>
	{:catch e}
		<p>Aborted: {JSON.stringify(e)}</p>
	{/await}
	<button on:click={() => c.abort()}>Abort</button>
</div>
