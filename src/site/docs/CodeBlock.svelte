<script>
  import { copyable } from './copy.js';

  /**
   * A highlighted code block. `html` is the `<pre>` produced at build time by Shiki (highlight.server.js); the styles are the
   * shared `.cb` ones of docs.css, so Markdown code blocks and these look the same.
   * @type {{ html: string, label?: string }}
   */
  let { html, label = 'TypeScript' } = $props();
</script>

<div class="cb" use:copyable>
  <div class="cb-head">
    <span class="cb-lang">{label}</span>
    <button type="button" class="cb-copy" data-copy aria-label="Copy code">Copy</button>
  </div>
  {@html html}
</div>
