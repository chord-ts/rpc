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
			format: {
				parse: (r) =>
					r.json().then((r) => {
						console.log('custom', r);
						return devalue.parse(r);
					}),
				stringify: (r) => {
					console.log('custom', JSON.stringify(devalue.stringify(r)))
					return JSON.stringify(devalue.stringify(r))
				}
			}
		}
	});
	let r = null;
	onMount(async () => {
		r = await rpc.TestRPC.dbReq(BigInt(123));
	});
</script>

<h1 class="text-sm text-primary">Test Endpoint</h1>
{#if r}
	{devalue.stringify(r)}
{/if}
