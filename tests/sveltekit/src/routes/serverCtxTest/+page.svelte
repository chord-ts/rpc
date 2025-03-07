<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '../../../../../src/';
	import type { Client } from './+server';

	export let data
	
	console.log(data.res)
</script>

<p>{data.res}</p>