<script>
  import '../../site/site.css';
  import Header from '../../site/Header.svelte';
  import Footer from '../../site/Footer.svelte';

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

<div class="site">
  <a class="skip-link" href="#main" onclick={skip}>Skip to content</a>
  <Header />
  <main id="main" tabindex="-1">
    {@render children()}
  </main>
  <Footer />
</div>
