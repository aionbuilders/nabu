<script>
  import GitHubIcon from '../../../site/GitHubIcon.svelte';
  import { GITHUB_URL } from '../../../site/nav.js';
  import { lockupLight, lockupDark, lockupMono, mark, decorative, classed } from '../../../site/brand/assets.js';
  import { FILES, KIT_URL, fileUrl } from '../../../site/brand/files.js';
  import { PALETTE, pair } from '../../../site/brand/palette.js';
  import Swatch from '../../../site/brand/Swatch.svelte';
  import Construction from '../../../site/brand/Construction.svelte';

  // The mark is brand/nabu-mark.svg, drawn with `currentColor`: each use sets `color`. Decorative uses are hidden from assistive tech.
  const markArt = decorative(mark);

  // The lockups are the shipped files, as they are.
  const LOCKUPS = [
    { id: 'light', svg: lockupLight, file: 'nabu-logo-light.svg', caption: 'On light' },
    { id: 'dark', svg: lockupDark, file: 'nabu-logo-dark.svg', caption: 'On dark' },
    { id: 'mono', svg: lockupMono, file: 'nabu-logo-mono.svg', caption: 'One colour' }
  ];

  // The icon sizes of the board, on their tiles.
  const SIZES = [
    { id: 'app', label: 'app · 512', tile: 96, mark: 59, radius: 22, bg: '#141416', color: '#FF6F61' },
    { id: 'touch', label: 'touch · 180', tile: 64, mark: 39, radius: 14, bg: '#FFFFFF', color: '#F04E31' },
    { id: 'tab', label: 'tab · 32', tile: 40, mark: 24, radius: 9, bg: '#141416', color: '#FF6F61' },
    { id: 'small', label: '16', tile: 24, mark: 14, radius: 5, bg: '#141416', color: '#FF6F61' }
  ];

  const ICON_FILES = FILES.filter((f) => !f.name.startsWith('nabu-logo'));

  // "Please don't": the same shipped lockup, wrongly used. Each tile is decorative; the caption says what is wrong.
  const wrong = classed(lockupDark);
  const WRONG_VIF = classed(lockupLight);
  const MISUSE = [
    { id: 'stretch', caption: 'Don’t stretch it.' },
    { id: 'recolour', caption: 'Don’t recolour the mark.' },
    { id: 'retype', caption: 'Don’t retype the word or capitalise it.' },
    { id: 'contrast', caption: 'Don’t use coral vif and ink on dark.' },
    { id: 'busy', caption: 'Don’t put it on busy pictures.' },
    { id: 'effects', caption: 'No shadows, glows or outlines.' }
  ];

  const VOICE = [
    ['We say “we”.', 'A project made by people, not a product talking about itself.'],
    ['We show the numbers, the bad ones too.', '“88 ms at 10,000 blocks, and here is why” beats “blazing fast”.'],
    ['Every claim links to its proof.', 'A test, a lab, a line of code.'],
    ['Short sentences. No superlatives.', 'If it needs “revolutionary”, it isn’t.'],
    ['We tell the story of our mistakes.', 'We got regions wrong once. It’s a chapter.']
  ];

  const STORY_TAGS = ['the river', 'the lantern', 'the rope', 'the oar', 'the ford', 'noon', 'dusk on the quay'];

  const TYPE = [
    { id: 'titles', label: 'Titles · Syne 700', note: 'Tight, −0.02 to −0.03 em. Never for body text.' },
    { id: 'text', label: 'Text · Inter', note: '400 for reading, 500–600 for labels.' },
    { id: 'code', label: 'Code · JetBrains Mono', note: 'Code, X-ray, small caps labels.' }
  ];

  // The contrast ratios quoted in the text are computed from the hex values (src/site/brand/contrast.js).
  const linkOnWhite = pair('link-on-white').text;
  const pastelOnNight = pair('pastel-on-night').text;
  const vifOnWhite = pair('vif-on-white').text;
</script>

<div class="brand">
  <section class="container hero" aria-labelledby="brand-title">
    <div class="hero-copy">
      <span class="eyebrow">Brand</span>
      <h1 id="brand-title">The scribe’s mark</h1>
      <p class="lead">
        Nabu is named after the Mesopotamian god of writing, the patron of scribes. Its mark is an N drawn in negative space and, if you look again, a pair of quotation marks, or wedges a scribe would press into clay. Here is how to use it, and how not to.
      </p>
      <div class="actions">
        <a class="btn primary" href={KIT_URL} download>Download the kit (.zip)</a>
        <a class="btn" href="{GITHUB_URL}/tree/main/brand"><GitHubIcon />brand/ on GitHub</a>
      </div>
    </div>
    <div class="hero-art" data-testid="hero-art">
      <div class="hero-mark" style:color="#FF6F61">{@html markArt}</div>
    </div>
  </section>

  <section class="container block" aria-labelledby="mark-title" id="mark">
    <header class="head">
      <span class="eyebrow">00 · The mark</span>
      <h2 id="mark-title">One mark, three readings</h2>
    </header>
    <div class="grid3">
      <figure>
        <div class="tile read1"><div class="m" style:width="170px" style:color="#0B0B0C">{@html markArt}</div></div>
        <figcaption>
          <span class="eyebrow">Reading 1</span>
          <strong>An N, in negative space</strong>
          <span class="desc">The four strokes are the walls; the letter is the space between them. Look at the coral, not at the shapes.</span>
        </figcaption>
      </figure>
      <figure>
        <div class="tile read2">
          <div class="m" style:width="64px" style:color="#FF6F61">{@html markArt}</div>
          <span class="quote">Nobody had crossed since noon.</span>
        </div>
        <figcaption>
          <span class="eyebrow">Reading 2</span>
          <strong>Quotation marks</strong>
          <span class="desc">An opening pair below, a closing pair above: someone is speaking. Fitting, for an editor.</span>
        </figcaption>
      </figure>
      <figure>
        <div class="tile read3"><div class="m" style:width="150px" style:color="#5A3E2B">{@html markArt}</div></div>
        <figcaption>
          <span class="eyebrow">Reading 3</span>
          <strong>Wedges in clay</strong>
          <span class="desc">The strokes a scribe pressed into wet clay with a reed: cuneiform, the writing Nabu was god of.</span>
        </figcaption>
      </figure>
    </div>
  </section>

  <section class="container block" aria-labelledby="logo-title" id="logo">
    <header class="head">
      <span class="eyebrow">01 · Logo</span>
      <h2 id="logo-title">The lockup</h2>
    </header>
    <div class="grid3">
      {#each LOCKUPS as l (l.id)}
        <figure>
          <div class="tile lockup {l.id}">{@html l.svg}</div>
          <figcaption class="file-row">
            <span>{l.caption}</span>
            <a class="file" href={fileUrl(l.file)} download={l.file} aria-label="Download {l.file}">{l.file}</a>
          </figcaption>
        </figure>
      {/each}
    </div>
  </section>

  <section class="container block construction" aria-labelledby="construction-title" id="construction">
    <div class="col">
      <header class="head">
        <span class="eyebrow">02 · Construction</span>
        <h2 id="construction-title">How it is built</h2>
      </header>
      <Construction />
    </div>
    <ul class="rules">
      <li><strong>The word</strong> is “nabu” in Syne 700, lowercase, tracked −0.02 em, drawn as outlines.</li>
      <li><strong>The mark</strong> is 1.2 × the height of the “b”, centred on the middle of the x-height, not sat on the baseline.</li>
      <li><strong>The gap</strong> between mark and word is 0.3 × the mark’s height.</li>
      <li><strong>Clear space</strong> around the lockup: the height of the “n”, on every side. Smallest size: 72 px wide (lockup), 16 px (mark alone).</li>
    </ul>
  </section>

  <section class="container block" aria-labelledby="icon-title" id="icon">
    <header class="head">
      <span class="eyebrow">03 · Icon</span>
      <h2 id="icon-title">The mark alone</h2>
    </header>
    <div class="sizes">
      {#each SIZES as s (s.id)}
        <div class="size">
          <div class="icon-tile" style:width="{s.tile}px" style:height="{s.tile}px" style:border-radius="{s.radius}px" style:background={s.bg} style:color={s.color}>
            <div class="m" style:width="{s.mark}px">{@html markArt}</div>
          </div>
          <span class="size-label">{s.label}</span>
        </div>
      {/each}
      <span class="grow"></span>
      <p class="icon-note">For favicons, app icons and avatars, when the word would be too small to read. Coral on dark, coral vif on white. Never the other way round.</p>
    </div>
    <ul class="files" aria-label="Icon and mark files">
      <li>
        <span class="thumb" style:color="#FF6F61" aria-hidden="true"><span class="m" style:width="28px">{@html markArt}</span></span>
        <span class="file-info"><span class="file-name">nabu-mark.svg</span><span class="file-note">{FILES.find((f) => f.name === 'nabu-mark.svg')?.note}</span></span>
        <a class="dl" href={fileUrl('nabu-mark.svg')} download="nabu-mark.svg" aria-label="Download nabu-mark.svg">Download</a>
      </li>
      {#each ICON_FILES.filter((f) => f.name !== 'nabu-mark.svg') as f (f.name)}
        <li>
          <img class="thumb" src={fileUrl(f.name)} alt="" width="40" height="40" loading="lazy" />
          <span class="file-info"><span class="file-name">{f.name}</span><span class="file-note">{f.note}</span></span>
          <a class="dl" href={fileUrl(f.name)} download={f.name} aria-label="Download {f.name}">Download</a>
        </li>
      {/each}
    </ul>
  </section>

  <section class="container block" aria-labelledby="colour-title" id="colour">
    <header class="head">
      <span class="eyebrow">04 · Palette</span>
      <h2 id="colour-title">Colour</h2>
    </header>
    <div class="palette">
      {#each PALETTE as c (c.id)}
        <Swatch color={c} />
      {/each}
    </div>
    <p class="fine" data-testid="contrast-note">
      Coral is an accent: one coral thing per screen is usually enough. Contrast: link coral on white <span data-testid="contrast-link">{linkOnWhite}</span>, pastel on night <span data-testid="contrast-pastel">{pastelOnNight}</span>, coral vif on white <span data-testid="contrast-vif">{vifOnWhite}</span>, so coral vif is for the mark and large type only, never for small text.
    </p>
  </section>

  <section class="container block" aria-labelledby="type-title" id="type">
    <header class="head">
      <span class="eyebrow">05 · Typography</span>
      <h2 id="type-title">Type</h2>
    </header>
    <div class="specimens">
      {#each TYPE as t (t.id)}
        <div class="specimen">
          <span class="spec-label">{t.label}</span>
          {#if t.id === 'titles'}
            <span class="spec titles">The last ferry</span>
          {:else if t.id === 'text'}
            <span class="spec text">The ferryman waited under the eaves, an unlit lantern in his hand. Nobody had crossed since noon.</span>
          {:else}
            <span class="spec code"><span class="kw">const</span> nabu = createEditor();</span>
          {/if}
          <span class="spec-note">{t.note}</span>
        </div>
      {/each}
    </div>
  </section>

  <div class="container two">
    <section class="block narrow" aria-labelledby="voice-title" id="voice">
      <header class="head">
        <span class="eyebrow">06 · Voice</span>
        <h2 id="voice-title">How we sound</h2>
      </header>
      <ul class="voice">
        {#each VOICE as [title, text] (title)}
          <li><strong>{title}</strong><span>{text}</span></li>
        {/each}
      </ul>
    </section>
    <section class="block narrow" aria-labelledby="story-title" id="story">
      <header class="head">
        <span class="eyebrow">07 · Our story</span>
        <h2 id="story-title">The ferryman</h2>
      </header>
      <div class="story">
        <p class="story-line">The <strong>ferryman</strong> waited under the eaves, an <em>unlit</em> lantern in his hand. Nobody had crossed since noon.</p>
        <p class="story-note">Every example in our docs, labs and tests tells the same little story: a river, a ferryman, a traveller who is late. Use it when you need sample text, never lorem ipsum.</p>
      </div>
      <ul class="tags" aria-label="Words of the story">
        {#each STORY_TAGS as tag (tag)}
          <li>{tag}</li>
        {/each}
      </ul>
    </section>
  </div>

  <section class="container block" aria-labelledby="misuse-title" id="misuse">
    <header class="head">
      <span class="eyebrow">08 · Misuse</span>
      <h2 id="misuse-title">Please don’t</h2>
    </header>
    <div class="misuse">
      {#each MISUSE as m (m.id)}
        <figure>
          <div class="tile bad bad-{m.id}">
            {#if m.id === 'retype'}
              <div class="retype">
                <div class="m" style:width="40px" style:color="#FF6F61">{@html markArt}</div>
                <span>Nabu</span>
              </div>
            {:else if m.id === 'contrast'}
              <div class="lk lk-wide">{@html WRONG_VIF}</div>
            {:else}
              <div class="lk" class:stretch={m.id === 'stretch'} class:recolour={m.id === 'recolour'} class:glow={m.id === 'effects'}>{@html wrong}</div>
            {/if}
            <span class="cross" aria-hidden="true">✕</span>
          </div>
          <figcaption>{m.caption}</figcaption>
        </figure>
      {/each}
    </div>
  </section>
</div>

<style>
  .brand {
    --tile-dark: #141416;
    --tile-dark-border: #232327;
    display: flex;
    flex-direction: column;
    gap: 64px;
    padding-bottom: 80px;
  }
  .brand :global(svg) {
    display: block;
  }
  h1,
  h2 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
  }
  h1 {
    font-size: 64px;
    line-height: 1;
    letter-spacing: var(--site-ls-display);
  }
  h2 {
    font-size: 36px;
    line-height: 1.1;
    letter-spacing: var(--site-ls-heading);
  }
  .eyebrow {
    font: 500 12px / 1.4 var(--site-font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--site-accent);
  }

  /* hero */
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 420px;
    gap: 40px;
    align-items: center;
    padding-block: 80px 0;
  }
  .hero-copy {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .lead {
    margin: 0;
    max-width: 600px;
    color: var(--site-text-muted);
    font-size: 19px;
    line-height: 1.6;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding-top: 8px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    min-height: 44px;
    padding: 0 18px;
    border: 1px solid var(--site-border-strong);
    border-radius: var(--site-radius-button);
    color: var(--site-text);
    font-weight: 500;
    text-decoration: none;
  }
  .btn:hover {
    background: var(--site-hover-bg);
  }
  .btn.primary {
    background: var(--site-accent-fill);
    border-color: transparent;
    color: var(--site-on-accent);
    font-weight: 600;
  }
  .btn.primary:hover {
    background: var(--site-accent-fill);
    opacity: 0.9;
  }
  /* The hero mark stays on night: a dark tile on the light theme, invisible (same as the page) on the dark one. The two light
     blocks mirror tokens.css and MUST stay identical. */
  .hero-art {
    display: flex;
    justify-content: center;
    padding: 48px 0;
    border-radius: 28px;
  }
  :global(:root[data-theme='light']) .hero-art {
    background: #0b0b0c;
  }
  @media (prefers-color-scheme: light) {
    :global(:root:not([data-theme='dark'])) .hero-art {
      background: #0b0b0c;
    }
  }
  .hero-mark {
    width: min(340px, 80%);
  }

  /* sections */
  .block {
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-width: 0;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .grid3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  figure {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    min-width: 0;
  }
  figcaption {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  figcaption strong {
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 20px;
    line-height: 1.3;
  }
  .desc {
    font-size: 14px;
    line-height: 1.55;
    color: var(--site-text-muted);
  }
  .tile {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 240px;
    border-radius: 18px;
    overflow: hidden;
  }
  .m :global(svg) {
    width: 100%;
    height: auto;
  }
  .read1 {
    background: #ff6f61;
  }
  .read2 {
    justify-content: flex-start;
    gap: 18px;
    padding: 0 28px;
    background: var(--tile-dark);
    border: 1px solid var(--tile-dark-border);
    color: #ededed;
  }
  .read2 .m {
    flex: none;
  }
  .quote {
    font: italic 400 24px / 1.35 Newsreader, Georgia, 'Times New Roman', serif;
  }
  .read3 {
    background: radial-gradient(circle at 30% 30%, #c9a27e, #8e6a4c);
  }

  /* lockups */
  .tile.lockup {
    height: 180px;
    border-radius: 16px;
  }
  .tile.lockup :global(svg) {
    width: min(260px, 80%);
    height: auto;
  }
  .lockup.light {
    background: #fff;
  }
  .lockup.dark {
    background: var(--tile-dark);
    border: 1px solid var(--tile-dark-border);
  }
  .lockup.mono {
    background: #f04e31;
    color: #fff;
  }
  .file-row {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 4px 12px;
    font-size: 13px;
    color: var(--site-text-muted);
  }
  .file {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    font: 400 12px / 1.4 var(--site-font-mono);
    color: var(--site-text-subtle);
    text-decoration: underline;
    text-decoration-color: transparent;
    text-underline-offset: 3px;
  }
  .file:hover {
    color: var(--site-text);
    text-decoration-color: currentColor;
  }

  /* construction */
  .construction {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 40px;
    align-items: start;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-width: 0;
  }
  .rules {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin: 92px 0 0;
    padding: 0;
    list-style: none;
    font-size: 15px;
    line-height: 1.55;
    color: var(--site-text-muted);
  }
  .rules strong {
    color: var(--site-text);
    font-weight: 600;
  }

  /* icon */
  .sizes {
    display: flex;
    flex-wrap: wrap;
    gap: 24px 40px;
    align-items: flex-end;
  }
  .size {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .icon-tile {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #808080 28%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .size-label {
    font: 400 11px / 1.4 var(--site-font-mono);
    color: var(--site-text-subtle);
  }
  .grow {
    flex-grow: 1;
  }
  .icon-note {
    margin: 0;
    max-width: 360px;
    font-size: 14px;
    line-height: 1.55;
    color: var(--site-text-muted);
  }
  .files {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 40px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }
  .files li {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 0;
    border-top: 1px solid var(--site-border-subtle);
  }
  .thumb {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 8px;
  }
  span.thumb {
    background: var(--tile-dark);
  }
  .file-info {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .file-name {
    font: 500 13px / 1.4 var(--site-font-mono);
    overflow-wrap: anywhere;
  }
  .file-note {
    font-size: 13px;
    line-height: 1.4;
    color: var(--site-text-muted);
  }
  .dl {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 10px;
    border-radius: var(--site-radius-control);
    font-size: 13px;
    font-weight: 500;
    color: var(--site-accent);
  }
  .dl:hover {
    background: var(--site-hover-bg);
  }

  /* colour */
  .palette {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 16px;
  }
  .fine {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--site-text-subtle);
  }

  /* type */
  .specimens {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--site-border-subtle);
  }
  .specimen {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr) 200px;
    gap: 24px;
    align-items: baseline;
    padding: 20px 0;
    border-top: 1px solid var(--site-border-subtle);
  }
  .spec-label {
    font: 400 12px / 1.4 var(--site-font-mono);
    text-transform: uppercase;
    color: var(--site-text-subtle);
  }
  .spec-note {
    font-size: 13px;
    line-height: 1.5;
    color: var(--site-text-muted);
  }
  .spec.titles {
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 44px;
    letter-spacing: -0.03em;
    line-height: 1.05;
  }
  .spec.text {
    font-size: 18px;
    line-height: 1.65;
    color: var(--site-text-muted);
  }
  .spec.code {
    font: 400 15px / 1.6 var(--site-font-mono);
    color: var(--site-text-muted);
  }
  .kw {
    color: var(--site-accent);
  }

  /* voice + story */
  .two {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 48px;
  }
  .narrow {
    gap: 14px;
  }
  .voice {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .voice li {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 0;
    border-top: 1px solid var(--site-border-subtle);
  }
  .voice strong {
    font-weight: 600;
    font-size: 16px;
  }
  .voice span {
    font-size: 14px;
    color: var(--site-text-muted);
  }
  .story {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px 26px;
    background: var(--site-surface);
    border: 1px solid var(--site-border);
    border-radius: var(--site-radius-panel);
  }
  .story p {
    margin: 0;
  }
  .story-line {
    font-size: 17px;
    line-height: 1.7;
  }
  .story-note {
    font-size: 14px;
    line-height: 1.6;
    color: var(--site-text-muted);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .tags li {
    padding: 4px 10px;
    border: 1px solid var(--site-border-strong);
    border-radius: 999px;
    font: 400 12px / 1.4 var(--site-font-mono);
    color: var(--site-text-muted);
  }

  /* misuse: dark tiles on both themes, the lockups shown are the ones for dark */
  .misuse {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  .misuse figure {
    gap: 8px;
  }
  .misuse figcaption {
    font-size: 13px;
    color: var(--site-text-muted);
  }
  .tile.bad {
    position: relative;
    height: 120px;
    border-radius: 12px;
    background: var(--tile-dark);
    border: 1px solid var(--tile-dark-border);
  }
  .tile.bad-busy {
    background: repeating-linear-gradient(45deg, #3a2522 0 12px, #23324a 12px 24px);
  }
  .cross {
    position: absolute;
    top: 8px;
    right: 10px;
    color: #ff6f61;
    font: 400 14px / 1 var(--site-font-mono);
  }
  .lk {
    width: min(170px, 70%);
  }
  .lk.stretch {
    width: min(150px, 50%);
    transform: scaleX(1.5);
  }
  .lk.glow {
    filter: drop-shadow(0 6px 10px rgba(255, 111, 97, 0.8));
  }
  .lk :global(svg) {
    width: 100%;
    height: auto;
  }
  .lk :global(.mark) {
    fill: #ff6f61;
  }
  .lk :global(.word) {
    fill: #f2f2f2;
  }
  .lk.recolour :global(.mark) {
    fill: #7aa2f7;
  }
  .lk-wide :global(.mark) {
    fill: #f04e31;
  }
  .lk-wide :global(.word) {
    fill: #1a1a1a;
  }
  .retype {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    color: #f2f2f2;
  }
  .retype span {
    font: 700 40px / 0.8 var(--site-font-display);
  }

  @media (max-width: 1099.98px) {
    .palette {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .construction {
      grid-template-columns: minmax(0, 1fr);
      gap: 22px;
    }
    .rules {
      margin-top: 0;
    }
  }
  @media (max-width: 899.98px) {
    .hero {
      grid-template-columns: minmax(0, 1fr);
      padding-top: 48px;
    }
    h1 {
      font-size: 48px;
    }
    .grid3,
    .two,
    .files {
      grid-template-columns: minmax(0, 1fr);
    }
    .two {
      gap: 64px;
    }
    .misuse {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .specimen {
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
    }
  }
  @media (max-width: 559.98px) {
    .brand {
      gap: 48px;
    }
    h1 {
      font-size: 40px;
    }
    h2 {
      font-size: 30px;
    }
    .palette {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .sizes {
      gap: 24px 20px;
    }
    .misuse {
      grid-template-columns: minmax(0, 1fr);
    }
    .spec.titles {
      font-size: 36px;
    }
    .lead {
      font-size: 17px;
    }
  }
</style>
