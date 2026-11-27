<script lang="ts">
  // v2 REST-клиент: манифест (OpenAPI) из load, дженерик — тип серверного rest-биндинга.
  import { rest } from '@chord/rpc/client';
  import { onMount } from 'svelte';
  import type { RestApi } from './[...path]/+server';

  export let data: { doc: any };

  let item = '';
  let created = '';
  onMount(async () => {
    const rpc = rest<RestApi>({ endpoint: location.origin, doc: data.doc });
    item = JSON.stringify(await rpc.Catalog.getItem({ item_id: '42', q: 'foo' }));
    created = JSON.stringify(await rpc.Catalog.createItem({ name: 'widget' }));
  });
</script>

<h1>v2 REST</h1>
<p>getItem: {item}</p>
<p>createItem: {created}</p>