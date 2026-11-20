<script lang="ts">
  import { onMount } from 'svelte';

  // Стандартный OpenRPC Playground (playground.open-rpc.org) — explorer с методами из спеки.
  // Спеку грузит по ?schemaUrl= (searchBarStore: query.schemaUrl || query.url || default; инлайн
  // ?schema= НЕ читается). URL документа — /v2/rpc/spec; playground fetch'ит его из браузера,
  // CORS для /v2/rpc добавлен в hooks.server.ts (localhost доступен из https-iframe по исключению).
  let src = '';
  onMount(() => {
    const schemaUrl = `${location.origin}/v2/rpc/spec`;
    src = `https://playground.open-rpc.org/?schemaUrl=${encodeURIComponent(schemaUrl)}`;
  });
</script>

<h1>OpenRPC Playground</h1>
<p>
  Стандартный explorer от OpenRPC — <a href="https://playground.open-rpc.org" target="_blank">playground.open-rpc.org</a>,
  спека грузится с <code>/v2/rpc/spec</code> (<code>?schemaUrl=</code>).
</p>

{#if src}
  <iframe {src} title="OpenRPC Playground"></iframe>
{:else}
  <p>Загрузка playground…</p>
{/if}

<style>
  iframe {
    width: 100%;
    height: 80vh;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
</style>