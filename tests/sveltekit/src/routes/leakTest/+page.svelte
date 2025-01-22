<script lang="ts">
  import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
  import {client} from '../../../../../../rpc/src/client'
	import type { Client } from './+server';

  export let data;

  const rpc = client<Client>({endpoint: '/leakTest'})

  let res = '';
</script>

<form method="POST" use:enhance={() => {
  return async({}) => {
    invalidate('user')
  }
}} class="flex flex-col items-center gap-2 pt-20" action="/leakTest">
  <input
    class="input input-sm input-bordered w-full"
    name="username"
    placeholder="Пользователь"
  />
  <button class="btn btn-primary btn-sm w-full" formaction="?/signin">Войти</button>
  <button
    class="btn btn-outline btn-primary btn-sm w-full
">Выйти</button
  >
</form>

<button on:click={async () => res = await rpc.Crud.ping(data.username)}>Call RPC</button>

{res}