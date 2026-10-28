<script>
  import { onMount, onDestroy, flushSync } from 'svelte';
  import DocArticle from '../docs/DocArticle.svelte';

  /**
   * The owner's letter in its two languages, with the EN · FR switch: the "palimpsest" (storyboard HowMadePalimpsest).
   *
   * Without JavaScript: the English letter, and the French original in a <details> below, both in the server HTML. Once hydrated
   * (`enhanced`) the switch appears, the <details> is opened and its summary hidden, and the two letters become two "panes" stacked in one
   * stage: one `current` (in the flow), the other `away` (absolute, invisible). Both stay REAL Nabu documents (read-only, hydrated) all the
   * time; nothing here ever touches their DOM.
   *
   * Switching A -> B, on one timeline (ms), all Web Animations created at t = 0 so the whole thing can be paused and scrubbed:
   *   0 -> scrapeMs          A (the `ghost`) fades to ghostOpacity with a hint of blur, and is NOT removed.
   *   scrapeMs -> writeEnd   B is "written" over it, word by word. B's real document waits (`incoming`, invisible); what is seen is a
   *                          decorative copy of it (`scribe`, a clone of the pane, aria-hidden, inert) whose words fade in. The stage eases
   *                          from A's height to B's height. Only the words on screen are staggered: the others are not seen anyway.
   *   writeEnd               the real document of B replaces the scribe in the same frame (identical layout, so no pixel moves), the note
   *                          changes, and the text becomes selectable.
   *   writeEnd -> +ghostFade the ghost fades out for good, under the real text.
   */
  const FEEL = {
    ghostOpacity: 0.13, // how faint the old language gets, 0..1
    ghostBlurPx: 0.3, // its hint of blur
    scrapeMs: 350, // beat 2: the old text is scraped back
    wordDelayMs: 12, // beat 3: delay between two words...
    writeMaxMs: 1250, // ...but the whole writing never lasts more than this (the letter has ~500 words: 12 ms each would take 6 s)
    wordFadeMs: 280, // one word, from transparent and blurred to sharp
    wordBlurPx: 1.5, // how blurred a word starts
    ghostFadeMs: 1000, // beat 5: the ghost fades out
    heightEasing: 'cubic-bezier(0.4, 0, 0.2, 1)', // the stage eases to the new height during the writing
  };

  /** @type {Lang[]} */
  const LANGS = ['en', 'fr'];
  const STORE_KEY = 'nabu:made-lang';
  /** @type {Record<'en' | 'fr', { note: string, label: string, name: string }>} */
  const COPY = {
    en: { note: 'Written in French by Killian, translated with Claude’s help.', label: 'In Killian’s own words', name: 'English' },
    fr: { note: 'Texte original, en français.', label: 'Dans les mots de Killian, en français', name: 'Français' },
  };

  /** @type {{ en: any, fr: any }} the two documents built by the page load */
  let { en, fr } = $props();

  /** @typedef {'en' | 'fr'} Lang */
  /** @typedef {'current' | 'away' | 'ghost' | 'incoming'} Role */

  let enhanced = $state(false);
  /** The pressed button: the language asked for. */
  let selected = $state(/** @type {Lang} */ ('en'));
  /** The language of the note: it changes when the writing ends (beat 4). */
  let noteLang = $state(/** @type {Lang} */ ('en'));
  let roles = $state(/** @type {Record<Lang, Role>} */ ({ en: 'current', fr: 'away' }));
  let busy = $state(false);

  /** @type {HTMLElement | undefined} */
  let stage = $state();
  /** @type {Record<Lang, HTMLElement | undefined>} */
  let panes = $state({ en: undefined, fr: undefined });

  /** @param {Lang} l @returns {Role | undefined} */
  const roleOf = (l) => (enhanced ? roles[l] : undefined);
  /** @param {Lang} l */
  const other = (l) => (l === 'en' ? 'fr' : 'en');
  /** The language that is really on the page: the current one, or (before the swap of a switch) the one that is being scraped back. @returns {Lang} */
  const baseLang = () => (roles.en === 'current' ? 'en' : roles.fr === 'current' ? 'fr' : roles.en === 'ghost' ? 'en' : 'fr');

  /** Each switch has a token; everything asynchronous checks it, so a click in the middle just invalidates the previous run. */
  let run = 0;
  /** @type {Animation[]} */
  let anims = [];
  /** @type {HTMLElement | null} */
  let scribe = null;

  const reduced = () => typeof Element.prototype.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Cancel everything in flight: the animations (their `finished` promises are ignored through the token) and the decorative copy. */
  function stop() {
    run++;
    for (const a of anims) a.cancel();
    anims = [];
    scribe?.remove();
    scribe = null;
  }

  /** The rest state: `lang` current, the other away, nothing animated, no ghost, no scribe. @param {Lang} lang */
  function settle(lang) {
    stop();
    roles = { ...roles, [lang]: 'current', [other(lang)]: 'away' };
    busy = false;
    noteLang = lang;
    flushSync();
    if (stage) stage.style.height = '';
  }

  /** @param {Lang} lang */
  function choose(lang) {
    if (lang === selected) return;
    selected = lang;
    try {
      localStorage.setItem(STORE_KEY, lang);
    } catch {
      /* private mode, blocked storage: the choice just is not remembered */
    }
    switchTo(lang);
  }

  /** @param {Lang} to */
  function switchTo(to) {
    if (!stage) return;
    const from = baseLang();
    // what the reader sees right now, if a switch is in flight (read before the animations are cancelled)
    const snap = busy ? { h: stage.getBoundingClientRect().height, op: Number(getComputedStyle(/** @type {HTMLElement} */ (panes[from])).opacity) } : null;
    stop();
    if (reduced()) return settle(to);
    if (from === to) return snap ? restore(to, snap) : settle(to);
    write(from, to, snap);
  }

  /** The reader came back to the language that was being scraped back: it is written back to full ink, the height eases back. @param {Lang} lang @param {{ h: number, op: number }} snap */
  function restore(lang, snap) {
    const tok = run;
    roles = { ...roles, [lang]: 'current', [other(lang)]: 'away' };
    busy = true;
    noteLang = lang;
    flushSync();
    const s = /** @type {HTMLElement} */ (stage);
    const natural = s.getBoundingClientRect().height;
    const opts = { duration: FEEL.scrapeMs, easing: FEEL.heightEasing, fill: /** @type {FillMode} */ ('forwards') };
    const h = s.animate([{ height: `${snap.h}px` }, { height: `${natural}px` }], opts);
    const o = /** @type {HTMLElement} */ (panes[lang]).animate([{ opacity: snap.op }, { opacity: 1 }], opts);
    anims.push(h, o);
    done(o, tok, () => settle(lang));
  }

  /** Run `fn` when `anim` finishes, unless a newer switch has taken over (a cancelled animation rejects: ignored). @param {Animation} anim @param {number} tok @param {() => void} fn */
  function done(anim, tok, fn) {
    anim.finished.then(() => tok === run && fn()).catch(() => {});
  }

  /** The decorative copy of a pane: same markup, same classes, so the same layout; words wrapped in spans. Never the real document. @param {HTMLElement} pane */
  function makeScribe(pane) {
    const s = /** @type {HTMLElement} */ (pane.cloneNode(true));
    s.dataset.role = 'scribe';
    s.setAttribute('aria-hidden', 'true');
    s.inert = true;
    for (const el of [s, ...s.querySelectorAll('*')]) {
      for (const a of ['id', 'data-testid', 'data-hydrated', 'contenteditable', 'tabindex', 'aria-label', 'aria-labelledby', 'role']) el.removeAttribute(a);
    }
    for (const live of s.querySelectorAll('[data-nabu-live], [data-nabu-ui]')) live.remove();
    /** @type {HTMLElement[]} */
    const words = [];
    const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    /** @type {Text[]} */
    const texts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\S/.test(n.nodeValue ?? '')) texts.push(/** @type {Text} */ (n));
    for (const t of texts) {
      const frag = document.createDocumentFragment();
      for (const part of (t.nodeValue ?? '').split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) frag.append(part);
        else {
          const w = document.createElement('span');
          w.className = 'w';
          w.textContent = part;
          words.push(w);
          frag.append(w);
        }
      }
      t.replaceWith(frag);
    }
    return { el: s, words };
  }

  /** The switch from `from` (scraped back) to `to` (written over it). @param {Lang} from @param {Lang} to @param {{ h: number, op: number } | null} snap */
  function write(from, to, snap) {
    const tok = run;
    const s = /** @type {HTMLElement} */ (stage);
    const ghostPane = /** @type {HTMLElement} */ (panes[from]);
    const toPane = /** @type {HTMLElement} */ (panes[to]);
    const h0 = snap?.h ?? s.getBoundingClientRect().height;
    const op0 = snap?.op ?? 1;

    roles = { ...roles, [from]: 'ghost', [to]: 'incoming' };
    busy = true;
    flushSync();
    const h1 = toPane.getBoundingClientRect().height;

    const copy = makeScribe(toPane);
    scribe = copy.el;
    s.append(scribe);

    // only the words that are on screen are written one after the other; the others are not seen, they just are there
    const lo = -80;
    const hi = innerHeight + 80;
    const seen = copy.words.filter((w) => {
      const r = w.getBoundingClientRect();
      return r.bottom > lo && r.top < hi;
    });
    const span = Math.min(Math.max(Math.max(seen.length - 1, 0) * FEEL.wordDelayMs + FEEL.wordFadeMs, FEEL.wordFadeMs), FEEL.writeMaxMs);
    const writeEnd = FEEL.scrapeMs + span;
    const step = seen.length > 1 ? Math.max(0, (span - FEEL.wordFadeMs) / (seen.length - 1)) : 0;
    const total = writeEnd + FEEL.ghostFadeMs;

    // beats 2 and 5: the ghost
    const blur = `blur(${FEEL.ghostBlurPx}px)`;
    const ghost = ghostPane.animate(
      [
        { opacity: op0, filter: 'blur(0px)', offset: 0, easing: 'ease-out' },
        { opacity: FEEL.ghostOpacity, filter: blur, offset: FEEL.scrapeMs / total },
        { opacity: FEEL.ghostOpacity, filter: blur, offset: writeEnd / total },
        { opacity: 0, filter: blur, offset: 1 },
      ],
      { duration: total, fill: 'forwards' },
    );
    // beat 3: the words, the height
    const inkIn = [{ opacity: 0, filter: `blur(${FEEL.wordBlurPx}px)` }, { opacity: 1, filter: 'blur(0px)' }];
    const written = seen.map((w, i) => w.animate(inkIn, { duration: FEEL.wordFadeMs, delay: FEEL.scrapeMs + i * step, easing: 'ease-out', fill: 'backwards' }));
    const height = s.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: writeEnd - FEEL.scrapeMs, delay: FEEL.scrapeMs, easing: FEEL.heightEasing, fill: 'both' });
    // beat 4: the clock of the writing; when it ends the real text takes the scribe's place, in the same frame
    const clock = copy.el.animate([{ opacity: 1 }, { opacity: 1 }], { duration: writeEnd });
    anims.push(ghost, height, clock, ...written);

    done(clock, tok, () => {
      roles = { ...roles, [from]: 'ghost', [to]: 'current' };
      noteLang = to;
      scribe?.remove();
      scribe = null;
      flushSync();
    });
    done(ghost, tok, () => settle(to));
  }

  onMount(() => {
    enhanced = true;
    try {
      if (localStorage.getItem(STORE_KEY) === 'fr') {
        selected = 'fr';
        settle('fr');
      }
    } catch {
      /* no storage: English */
    }
  });
  onDestroy(() => {
    run++;
    for (const a of anims) a.cancel();
  });
</script>

<div class="essay-switch">
  <div class="bar">
    <div class="toggle" class:ready={enhanced} role="group" aria-label="Language of the letter" data-testid="lang-toggle">
      {#each LANGS as l (l)}
        <button type="button" lang={l} aria-label={COPY[l].name} aria-pressed={selected === l} onclick={() => choose(l)} data-lang={l}>{l.toUpperCase()}</button>
      {/each}
    </div>
    <p class="byline" data-testid="byline">
      {#each LANGS as l (l)}
        <span lang={l} class:on={noteLang === l} data-testid="byline-{l}">{COPY[l].note}</span>
      {/each}
    </p>
  </div>

  <div class="stage" class:on={enhanced} bind:this={stage} data-testid="essay-stage" data-state={busy ? 'busy' : 'idle'} data-selected={selected}>
    <div
      class="made-essay pane"
      data-testid="essay-en"
      lang="en"
      data-role={roleOf('en')}
      aria-hidden={enhanced && roles.en !== 'current' ? 'true' : undefined}
      inert={enhanced && roles.en !== 'current'}
      bind:this={panes.en}
    >
      <DocArticle doc={en} label={COPY.en.label} />
      <p class="signature">Killian Di Vincenzo</p>
    </div>

    <details class="original" data-testid="original" open={enhanced}>
      <summary>Read the original in French</summary>
      <div
        class="made-essay pane"
        data-testid="essay-fr"
        lang="fr"
        data-role={roleOf('fr')}
        aria-hidden={enhanced && roles.fr !== 'current' ? 'true' : undefined}
        inert={enhanced && roles.fr !== 'current'}
        bind:this={panes.fr}
      >
        <DocArticle doc={fr} lang="fr" label={COPY.fr.label} />
        <p class="signature">Killian Di Vincenzo</p>
      </div>
    </details>
  </div>
</div>

<style>
  .essay-switch {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-6);
    min-width: 0;
  }

  /* the bar: the switch on the left, the note on the right (under it on a narrow screen) */
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--site-space-2) var(--site-space-6);
  }
  .toggle {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--site-border-strong);
    border-radius: 999px;
    visibility: hidden; /* it exists in the server HTML, so nothing moves when it shows, but there is nothing to press without JavaScript */
  }
  .toggle.ready {
    visibility: visible;
  }
  .toggle button {
    appearance: none;
    min-width: 44px;
    padding: 7px 14px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--site-text-muted);
    font: 500 13px / 1.2 var(--site-font-body);
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .toggle button:hover {
    color: var(--site-text);
  }
  .toggle button[aria-pressed='true'] {
    background: var(--site-text);
    color: var(--site-bg);
    cursor: default;
  }

  /* the note: both sentences share one cell, so the bar keeps the height of the longer one and nothing moves when the note changes */
  .byline {
    display: grid;
    margin: 0;
    min-width: 0;
    flex: 1 1 280px;
    font-family: var(--made-serif);
    font-style: italic;
    font-size: 22px;
    line-height: 1.5;
    color: var(--site-text-subtle);
    text-align: end;
  }
  .byline span {
    grid-area: 1 / 1;
    visibility: hidden;
  }
  .byline span.on {
    visibility: visible;
  }

  .signature {
    margin: 0;
    font-family: var(--made-serif);
    font-style: italic;
    font-size: 24px;
    color: var(--site-text);
  }

  .stage {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .pane {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-6);
    min-width: 0;
  }

  /* without JavaScript: the French original in a disclosure under the English letter, as it always was */
  .original {
    margin-top: var(--site-space-6);
    padding-top: var(--site-space-4);
    border-top: 1px solid var(--site-border);
  }
  .original[open] {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-6);
  }
  summary {
    list-style: none;
    width: fit-content;
    cursor: pointer;
    color: var(--site-accent);
    font-family: var(--made-serif);
    font-style: italic;
    font-size: 22px;
    line-height: 1.4;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary::before {
    content: '+ ';
    font-style: normal;
  }
  details[open] > summary::before {
    content: '− ';
  }
  summary:hover {
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  /* with JavaScript: one stage, the two letters stacked in it */
  .stage.on .original {
    display: block;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .stage.on summary {
    display: none;
  }
  .stage.on .pane[data-role='away'],
  .stage.on .pane[data-role='incoming'],
  .stage.on .pane[data-role='ghost'] {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
  }
  .stage.on .pane[data-role='away'],
  .stage.on .pane[data-role='incoming'] {
    visibility: hidden;
    pointer-events: none;
  }
  .stage.on .pane[data-role='ghost'] {
    z-index: 0;
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .stage.on .pane[data-role='current'],
  .stage.on .pane[data-role='incoming'] {
    z-index: 1;
  }
  .stage[data-state='busy'] {
    overflow: hidden; /* a longer ghost never runs over what is under the stage while the height eases */
    overflow: clip;
  }
  /* the decorative copy being written (made at runtime, so its parts are :global) */
  .stage :global([data-role='scribe']) {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
  }

  @media (max-width: 639.98px) {
    .byline,
    .signature {
      font-size: 20px;
    }
    .byline {
      text-align: start;
    }
    summary {
      font-size: 20px;
    }
  }
</style>
