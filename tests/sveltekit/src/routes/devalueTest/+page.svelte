<script lang="ts">
	import { RPC, Builder, client } from '../../../../../src/client';

	import { onMount } from 'svelte';
	import type { Client } from './+server';
	import { writable } from 'svelte/store';
	import { updated } from '$app/stores';
	import * as devalue from 'devalue';

	const error = writable();
	const abortController = new AbortController();

	const rpc = client<Client>({
		endpoint: '/devalueTest',
		config: {
			format: {
				parse: (r) =>
					r.json().then((r) => {
						console.log('custom', r);
						return devalue.parse(r);
					}),
				stringify: (r) => {
					console.log('custom', JSON.stringify(devalue.stringify(r)));
					return JSON.stringify(devalue.stringify(r));
				}
			}
		}
	});
	let r = null;
	onMount(async () => {
		// console.log(rpc.abort(abortController.signal))
		r = await rpc
			.abort(abortController.signal)
			.TestRPC.dbReq(BigInt(123))
			.catch((e) => {
				if (e.name === 'AbortError') {
					return
				}
				console.error(e.message);
			});
	});
</script>

<h1 class="text-sm text-primary">Test Endpoint</h1>
<button on:click={() => abortController.abort()}>Stop</button>
{#if r}
	{devalue.stringify(r)}
{/if}
