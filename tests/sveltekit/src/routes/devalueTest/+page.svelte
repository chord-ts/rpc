<script lang="ts">
	import { RPC, Builder, client } from '../../../../../src/client';

	import { onMount } from 'svelte';
	import type { Client } from './+server';
	import { writable } from 'svelte/store';
	import { updated } from '$app/stores';
	import * as devalue from 'devalue';

	const error = writable();

	const rpc = client<Client>({
		endpoint: '/devalueTest',
		config: {
			parser: (r) =>
				r.json().then((r) => {
					console.log(r);
					return devalue.parse(r);
				})
		}
	});
	let r = null;
	onMount(async () => {
		r = await rpc.TestRPC.dbReq();
	});
</script>

<h1 class="text-sm text-primary">Test Endpoint</h1>
{#if r}
	{devalue.stringify(r)}
{/if}
