<script lang="ts">
  // v2 REST-клиент: манифест (OpenAPI) из load, дженерик — тип серверного rest-биндинга.
  import { rest } from '@chord/rpc/client';
  import { onMount } from 'svelte';
  import type { RestApi } from './[...path]/+server';

  export let data: { doc: any };

  let item = '';
  let created = '';
  // Новые примеры (раунд 4).
  let searchMany = '';
  let searchOne = '';
  let searchEmpty = '';
  let meta = '';
  let sum = '';
  let orderOk = '';
  let orderErr = '';

  onMount(async () => {
    const rpc = rest<RestApi>({ endpoint: location.origin, doc: data.doc });
    item = JSON.stringify(await rpc.Catalog.getItem({ item_id: '42', q: 'foo' }));
    created = JSON.stringify(await rpc.Catalog.createItem({ name: 'widget' }));

    // array-query round trip: повторные ключи, одиночный, пустой.
    searchMany = JSON.stringify(await rpc.Demo.search({ tag: ['a', 'b'] }));
    searchOne = JSON.stringify(await rpc.Demo.search({ tag: ['a'] }));
    searchEmpty = JSON.stringify(await rpc.Demo.search({ tag: [] }));
    // record-body шлётся плоско; массив-body — под ключом body.
    meta = JSON.stringify(await rpc.Demo.meta({ a: 1, b: 2, c: 3 }));
    sum = JSON.stringify(await rpc.Demo.sum({ body: [1, 2, 3] }));
    // HttpError: успех и намеренный 409 с data под resp-схему.
    orderOk = JSON.stringify(await rpc.Demo.createOrder({ sku: 'ABC' }));
    try {
      await rpc.Demo.createOrder({ sku: 'DUP' });
    } catch (e) {
      const err = e as { status?: number; body?: unknown };
      orderErr = `${err.status} ${JSON.stringify(err.body)}`;
    }
  });
</script>

<h1>v2 REST</h1>
<p>getItem: {item}</p>
<p>createItem: {created}</p>

<h2>Новые примеры</h2>
<p>search ['a','b']: {searchMany}</p>
<p>search ['a']: {searchOne}</p>
<p>search []: {searchEmpty}</p>
<p>meta (record body): {meta}</p>
<p>sum (array body slot): {sum}</p>
<p>createOrder ok: {orderOk}</p>
<p>createOrder 409: {orderErr}</p>