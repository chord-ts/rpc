<script lang="ts">

	import { onMount } from 'svelte';
  import {logger, service} from './client'

  onMount(async() => {
    console.log('onMount')
    // console.log( await service.hello('world'))
    console.log( await service.hello('world'))
    logger.info('heellooo')
  })
</script>