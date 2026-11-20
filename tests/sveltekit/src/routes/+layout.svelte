<script lang="ts">
  import { page } from '$app/stores';

  const v1 = [
    'abortTest', 'authTest', 'autoInit', 'baseTest', 'cacheTest', 'classTest',
    'devalueTest', 'leakTest', 'middlewareTest', 'redirectTest', 'schemaTest',
    'serverCacheTest', 'serverCtxTest',
  ];
  const v2 = ['rpc', 'rest'];

  $: path = $page.url.pathname;
</script>

<div class="layout">
  <nav>
    <a href="/" class="home" class:active={path === '/'}>chord-ts/rpc tests</a>

    <section>
      <h2>v1 <span>deprecated</span></h2>
      <ul>
        {#each v1 as name}
          {@const href = `/v1/${name}`}
          <li><a {href} class:active={path === href || path.startsWith(href + '/')}>{name}</a></li>
        {/each}
      </ul>
    </section>

    <section>
      <h2>v2</h2>
      <ul>
        {#each v2 as name}
          {@const href = `/v2/${name}`}
          <li><a {href} class:active={path === href || path.startsWith(href + '/')}>{name}</a></li>
        {/each}
      </ul>
    </section>
  </nav>

  <main>
    <slot />
  </main>
</div>

<style>
  .layout {
    display: flex;
    min-height: 100vh;
    font-family: system-ui, sans-serif;
  }
  nav {
    flex: 0 0 220px;
    padding: 1rem;
    border-right: 1px solid #ddd;
    background: #fafafa;
    overflow-y: auto;
  }
  nav .home {
    display: block;
    font-weight: 700;
    margin-bottom: 1rem;
    text-decoration: none;
    color: #111;
  }
  nav h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666;
    margin: 1rem 0 0.4rem;
  }
  nav h2 span {
    font-size: 0.65rem;
    color: #b0b0b0;
    text-transform: none;
  }
  nav ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  nav li a {
    display: block;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    text-decoration: none;
    color: #333;
    font-size: 0.9rem;
  }
  nav li a:hover:not(.active) {
    background: #ececec;
  }
  nav a.active {
    background: #007acc;
    color: #fff;
  }
  main {
    flex: 1;
    padding: 1.5rem;
    min-width: 0;
  }
</style>