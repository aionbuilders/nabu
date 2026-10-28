<script>
  import Shell from '../../site/Shell.svelte';

  let { children } = $props();
</script>

<Shell>{@render children()}</Shell>
