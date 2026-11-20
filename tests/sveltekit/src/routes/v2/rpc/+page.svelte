<script lang="ts">
  // v2-клиент из опубликованного пакета: дженерик — тип серверного биндинга.
  import { jsonrpc } from '@chord/rpc/client';
  import { onMount } from 'svelte';
  import type { ClientType } from './+server';

  const rpc = jsonrpc<ClientType>({ endpoint: '/v2/rpc' });

  let result = '';
  let error = '';
  onMount(async () => {
    result = String(await rpc.Math.add({ a: 2, b: 3 }));
    try {
      await rpc.Math.add({ a: 'x', b: 3 } as any);
    } catch (e) {
      error = `${(e as Error).name}: ${(e as Error).message}`;
    }
  });
</script>

<h1>v2 RPC</h1>
<p>2 + 3 = {result}</p>
<p>validation error: {error}</p>