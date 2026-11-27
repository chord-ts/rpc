<script lang="ts">
  // v2-клиент из опубликованного пакета: дженерик — тип серверного биндинга.
  import { jsonrpc } from '@chord/rpc/client';
  import { RpcError } from '@chord/rpc';
  import { onMount } from 'svelte';
  import type { ClientType } from './+server';

  const rpc = jsonrpc<ClientType>({ endpoint: '/v2/rpc' });

  let add = '';
  let sumAll = '';
  let validation = '';
  let notFound = '';
  let div = '';
  let divError = '';
  let internal = '';
  let echo = '';
  let greet = '';
  let upper = '';
  let double = '';
  let not = '';
  let repeat = '';
  let pad = '';
  let scalarParams = '';
  let multiParams = '';
  let discover = '';
  let getSpec = '';
  let now = '';
  let whoami = '';

  // Нативные ошибки клиента: RpcError несёт проводные code/message/data.
  const describe = (e: unknown) =>
    e instanceof RpcError
      ? `RpcError ${e.code}: ${e.message}${e.data === undefined ? '' : ` · data: ${JSON.stringify(e.data)}`}`
      : String(e);

  onMount(async () => {
    add = String(await rpc.Math.add({ a: 2, b: 3 }));
    sumAll = String(await rpc.Math.sumAll([1, 2, 3]));

    try {
      await rpc.Math.add({ a: 'x', b: 3 } as any);
    } catch (e) {
      validation = describe(e);
    }

    try {
      await (rpc as any).Math.nope();
    } catch (e) {
      notFound = describe(e);
    }

    div = String(await rpc.Math.div({ a: 7, b: 2 }));
    try {
      await rpc.Math.div({ a: 1, b: 0 });
    } catch (e) {
      divError = describe(e);
    }

    try {
      await rpc.Math.sqrt({ x: -1 });
    } catch (e) {
      internal = describe(e);
    }

    echo = await rpc.Greeter.echo('ping');
    greet = await rpc.Greeter.greet('Hello', 'World');

    upper = await rpc.Scalars.upper('hello');
    double = String(await rpc.Scalars.double(21));
    not = String(await rpc.Scalars.not(true));
    repeat = await rpc.Scalars.repeat('ab', 3);
    pad = await rpc.Scalars.pad('7', 3, '0');

    const doc = await (rpc as any).rpc.discover();
    discover = `OpenRPC ${doc.openrpc} · ${doc.methods.map((m: { name: string }) => m.name).join(', ')}`;
    scalarParams = JSON.stringify(doc.methods.find((m: { name: string }) => m.name === 'Scalars.upper').params);
    multiParams = JSON.stringify(doc.methods.find((m: { name: string }) => m.name === 'Scalars.pad').params);

    // GET-эндпоинт отдаёт ту же OpenRPC-спеку напрямую (без JSON-RPC конверта).
    getSpec = await (await fetch('/v2/rpc/spec')).text();

    const d = await rpc.Clock.now(undefined);
    now = `${typeof d} → ${d}`;

    whoami = await rpc.Session.whoami(undefined);
  });
</script>

<h1>v2 RPC</h1>

<section>
  <h2>Типизированный вызов</h2>
  <p>Math.add({'{ a: 2, b: 3 }'}) = {add}</p>
  <p>Math.sumAll([1, 2, 3]) = {sumAll} — массив как одно значение, провод [[…]]</p>
</section>

<section>
  <h2>Ошибки</h2>
  <p>валидация входа (a: 'x'): {validation}</p>
  <p>неизвестный метод Math.nope: {notFound}</p>
  <p>Math.div({'{ a: 7, b: 2 }'}) = {div}</p>
  <p>бизнес-ошибка div на 0: {divError}</p>
  <p>обычный Error в sqrt(-1): {internal}</p>
</section>

<section>
  <h2>Simple-эндпоинты без $method</h2>
  <p>Greeter.echo('ping') = {echo}</p>
  <p>Greeter.greet('Hello', 'World') = {greet} (позиционные аргументы)</p>
</section>

<section>
  <h2>Скалярные схемы (zod)</h2>
  <p>Scalars.upper('hello') = {upper}</p>
  <p>Scalars.double(21) = {double}</p>
  <p>Scalars.not(true) = {not}</p>
  <p>Scalars.repeat('ab', 3) = {repeat} (by-position аргументы)</p>
  <p>Scalars.pad('7', 3, '0') = {pad} (третий аргумент optional)</p>
  <p>OpenRPC params скалярного входа — один позиционный дескриптор arg0 (провод [value]): {scalarParams}</p>
  <p>OpenRPC params tuple-входа: {multiParams}</p>
</section>

<section>
  <h2>Discovery</h2>
  <p>rpc.discover (POST): {discover}</p>
</section>

<section>
  <h2>GET OpenRPC спека</h2>
  <p><a href="/v2/rpc/spec" target="_blank">GET /v2/rpc/spec</a> — тот же документ напрямую, без JSON-RPC конверта · <a href="/v2/rpc/openrpc">clef — OpenRPC explorer + Try it →</a></p>
  <pre class="spec">{getSpec}</pre>
</section>

<section>
  <h2>Формат json</h2>
  <p>Clock.now (out: z.date()): {now} — Date не переживает json-провод</p>
</section>

<section>
  <h2>Контекст из locals (DI)</h2>
  <p>Session.whoami = {whoami} — зависимость user приходит из hooks.server.ts</p>
</section>

<style>
  .spec {
    background: #f4f4f4;
    padding: 1rem;
    border-radius: 4px;
    max-height: 24rem;
    overflow: auto;
    font-size: 0.8rem;
    white-space: pre;
  }
</style>