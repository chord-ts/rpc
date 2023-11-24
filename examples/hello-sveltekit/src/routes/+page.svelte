<script lang="ts">
  import { dynamicClient } from 'chord-rpc';
  import { onMount } from 'svelte';

  // Import our Contract
  import type { Wrapped } from './+server';

  // Init dynamic client with type checking
  // Use Contract as Generic to get type safety and hints from IDE
  // dynamicClient means that RPC will be created during code execution 
  // and executed when the function call statement is found

  let res;
  // Called after Page mount. The same as useEffect(..., [])
  onMount(async () => {
    // Call method defined on backend with type-hinting
    const rpc = dynamicClient<Wrapped>();

    res = await rpc.HelloRPC.hello('world');
    console.log(res);
  });
</script>

<h1>Chord call Test</h1>
<p>Result: {res}</p>