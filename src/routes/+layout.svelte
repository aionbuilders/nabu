<script>
  import '../lib/nabu-theme.css';
  import { dev } from '$app/env';
  import { page } from '$app/state';

  // No analytics in dev, nor in the e2e production build (`build:e2e`): keeps the test pages free of third-party requests.
  const analytics = !dev && import.meta.env.VITE_NABU_E2E !== '1';

  // Update once the domain is confirmed
  const SITE_URL = 'https://nabu.aion.builders';
  const DEFAULT_TITLE = 'Nabu — Modular block editor engine for Svelte 5';
  const DESCRIPTION = 'A local-first, modular block editor engine for Svelte 5. Single contenteditable, Loro-CRDT state, and an extension registry for custom block types.';

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Nabu',
    description: DESCRIPTION,
    url: SITE_URL,
    downloadUrl: 'https://www.npmjs.com/package/@aionbuilders/nabu',
    softwareVersion: '0.1.0-alpha',
    operatingSystem: 'Web',
    applicationCategory: 'DeveloperApplication',
    programmingLanguage: 'JavaScript',
    license: 'https://opensource.org/licenses/MIT',
    author: {
      '@type': 'Person',
      name: 'Killian Di Vincenzo',
      url: 'https://github.com/killiandvcz',
    },
    codeRepository: 'https://github.com/aionbuilders/nabu',
    keywords: ['svelte', 'block editor', 'crdt', 'local-first', 'rich text'],
  });

  let { children } = $props();

  // A page can override the title and opt out of indexing through its load data (`{ title, noindex }`): a nested <svelte:head>
  // <title> would be rendered next to this one (duplicate tags), so the single source of truth stays here.
  const TITLE = $derived(page.data.title ?? DEFAULT_TITLE);
  const canonical = $derived(SITE_URL + (page.url.pathname === '/' ? '' : page.url.pathname));
</script>

<svelte:head>
  <!-- Primary -->
  <title>{TITLE}</title>
  <meta name="description" content={DESCRIPTION} />
  <meta name="keywords" content="svelte, svelte5, block editor, rich text editor, contenteditable, crdt, loro, local-first, collaborative, npm, javascript" />
  <meta name="author" content="Killian Di Vincenzo" />
  <meta name="robots" content={page.data.noindex ? 'noindex, follow' : 'index, follow'} />
  <link rel="canonical" href={canonical} />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content={canonical} />
  <meta property="og:title" content={TITLE} />
  <meta property="og:description" content={DESCRIPTION} />
  <meta property="og:image" content="{SITE_URL}/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Nabu block editor — live demo" />
  <meta property="og:site_name" content="Nabu" />
  <meta property="og:locale" content="en_US" />

  <!-- Twitter / X -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={TITLE} />
  <meta name="twitter:description" content={DESCRIPTION} />
  <meta name="twitter:image" content="{SITE_URL}/og.png" />
  <meta name="twitter:image:alt" content="Nabu block editor — live demo" />

  <!-- JSON-LD -->
  {@html `<script type="application/ld+json">${jsonLd}<` + `/script>`}

  <!-- Plausible Analytics (production only) -->
  {#if analytics}
    <script async src="https://plausible.io/js/pa-FXhGAcvagGM3pf-uN0Xmj.js"></script>
    {@html `<script>window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()<` + `/script>`}
  {/if}
</svelte:head>

{@render children()}
