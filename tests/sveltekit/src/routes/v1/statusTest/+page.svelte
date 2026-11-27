<script lang="ts">
  import { client } from '@chord/rpc/client';
  import type { Client } from './+server';

  const rpc = client<Client>({ endpoint: '/v1/statusTest' });

  let out = '';
  async function run(name: 'ok' | 'error500' | 'error404' | 'nonjson' | 'redirect') {
    out = `${name}: pending…`;
    try {
      const r = await rpc.Status[name]();
      out = `${name}: OK → ${JSON.stringify(r)}`;
    } catch (e) {
      const err = e as Error & { data?: unknown; code?: number };
      out = `${name}: ERROR code=${err.code} "${err.message}"\ndata=${JSON.stringify(err.data)}`;
    }
  }
</script>

<h1>v1 status handling</h1>
<p>Демо статус-aware транспорта: редирект navigates, error-страницы пакуются без JSON-парса (предпросмотр в console).</p>

<div class="buttons">
  <button on:click={() => run('ok')}>ok (200 JSON-RPC)</button>
  <button on:click={() => run('error500')}>error500 (HTML)</button>
  <button on:click={() => run('error404')}>error404 (HTML)</button>
  <button on:click={() => run('nonjson')}>nonjson (200 text)</button>
  <button on:click={() => run('redirect')}>redirect (303 → navigates)</button>
</div>

<pre>{out}</pre>

<style>
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 1rem 0;
  }
  button {
    padding: 0.4rem 0.8rem;
    cursor: pointer;
  }
  pre {
    background: #f4f4f4;
    padding: 1rem;
    border-radius: 4px;
    white-space: pre-wrap;
    min-height: 3rem;
  }
</style>