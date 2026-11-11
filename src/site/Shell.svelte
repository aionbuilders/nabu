<script>
  import './site.css';
  import Header from './Header.svelte';
  import Footer from './Footer.svelte';
  // Critical latin faces, preloaded so they do not arrive after the render-blocking CSS (late swap = layout shift).
  // Same files the @fontsource @font-face rules point at, so Vite emits one hashed URL for each.
  import interRegular from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
  import interSemibold from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
  import syneBold from '@fontsource/syne/files/syne-latin-700-normal.woff2?url';

  const PRELOADED_FONTS = [interRegular, interSemibold, syneBold];

  /** The page chrome of the site (skip link, header, main, footer): the `(site)` layout and the error page wear the same one. */
  let { children } = $props();

  /** @param {MouseEvent} e */
  function skip(e) {
    // Move focus explicitly: the client router would otherwise reset it to <body> after the hash navigation.
    e.preventDefault();
    const main = document.getElementById('main');
    main?.focus();
    main?.scrollIntoView();
  }
</script>

<svelte:head>
  {#each PRELOADED_FONTS as href (href)}
    <link rel="preload" as="font" type="font/woff2" {href} crossorigin="anonymous" />
  {/each}
</svelte:head>

<div class="site">
  <a class="skip-link" href="#main" onclick={skip}>Skip to content</a>
  <Header />
  <main id="main" tabindex="-1">
    {@render children()}
  </main>
  <Footer />
</div>
