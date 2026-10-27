<script>
  import DocFooter from '../../../../../site/docs/DocFooter.svelte';
  import TourStory from '../../../../../site/tour/TourStory.svelte';
  import TourWall from '../../../../../site/tour/TourWall.svelte';
  import TourMore from '../../../../../site/tour/TourMore.svelte';

  let { data } = $props();
  const tour = $derived(data.tour);

  /** @type {TourWall | undefined} */
  let wall = $state();
  /** @type {HTMLElement | undefined} */
  let root = $state();
  $effect(() => {
    root?.setAttribute('data-hydrated', ''); // every example has been hydrated (the children's effects run first): the e2e specs wait for it
  });
</script>

<div class="tour" bind:this={root} data-testid="tour-page">
  <nav class="crumb" aria-label="Breadcrumb">
    <a href="/docs">Docs</a> / <a href="/docs#{data.page.section}">{data.page.sectionTitle}</a>
  </nav>

  <header class="intro">
    <div class="words">
      <h1>{data.page.title}</h1>
      <p class="lead">One short story, written with every block Nabu ships. Hover any part of it to see what it is and how to make one.</p>
    </div>
    <ul class="legend" aria-label="The tour in numbers" data-testid="tour-legend">
      <li><strong>{tour.legend.blocks}</strong> blocks</li>
      <li><strong>{tour.legend.behaviours}</strong> text behaviours</li>
      <li><strong>{tour.legend.paste}</strong> paste handlers</li>
      <li><strong>{tour.legend.transform}</strong> transform</li>
    </ul>
  </header>

  <TourStory story={tour.story} cards={tour.cards} cardOf={tour.cardOf} onopen={(id) => wall?.toggleCard(id)} />

  <p class="down">Every block, one by one <span aria-hidden="true">↓</span></p>

  <TourWall bind:this={wall} cards={tour.cards} />

  <TourMore typing={tour.typing} paste={tour.paste} transform={tour.transform} />

  <DocFooter edit={data.edit} prev={data.prev} next={data.next} />
</div>

<style>
  .tour {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-12);
    min-width: 0;
  }
  .crumb {
    margin-bottom: calc(var(--site-space-12) * -1 + var(--site-space-3));
    font-size: 13px;
    color: var(--site-text-subtle);
    overflow-wrap: anywhere;
  }
  .crumb a {
    color: inherit;
    text-decoration: none;
  }
  .crumb a:hover {
    color: var(--site-text);
  }
  .intro {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-end;
    gap: var(--site-space-6);
  }
  .words {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-3);
    max-width: 720px;
  }
  h1 {
    margin: 0;
    font: 700 clamp(36px, 7vw, 56px) / 1.02 var(--site-font-display);
    letter-spacing: -0.03em;
  }
  .lead {
    margin: 0;
    color: var(--site-text-muted);
    font-size: clamp(17px, 2.4vw, 19px);
    line-height: 1.6;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 22px;
    margin: 0;
    padding: 0 0 6px;
    list-style: none;
    color: var(--site-text-muted);
    font-size: 14px;
  }
  .legend strong {
    margin-right: 4px;
    color: var(--site-text);
    font: 700 22px var(--site-font-display);
  }
  .down {
    margin: calc(var(--site-space-6) * -1) 0 0;
    text-align: center;
    color: var(--site-text-subtle);
    font-size: 14px;
  }
</style>
