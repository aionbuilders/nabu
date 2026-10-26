// @ts-nocheck
import { flushSync } from 'svelte';

/** Record every value `persistence.status` takes, as an `$effect` of a Svelte component would see it (flush on demand). */
export function recordStatuses(persistence) {
  const log = [];
  const stop = $effect.root(() => {
    $effect(() => { log.push(persistence.status); });
  });
  flushSync();
  const watcher = setInterval(() => flushSync(), 0);
  return { log, stop: () => { clearInterval(watcher); stop(); } };
}
