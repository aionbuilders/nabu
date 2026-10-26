/**
 * Deterministic generator of large Nabu documents (the `serialize('json')` export format, read back by `nabu.importJSON`).
 * Used by the perf measurements (large-docs.perf.ts) and by the regression guards (../large-docs.spec.ts).
 *
 * Mix (by node count): ~10% headings, ~15% of the paragraphs carry a bold / italic run, a list of 3 items every ~20 blocks, a toggle
 * (with 2 paragraphs inside) every ~50 blocks, a code block every 200 blocks. Paragraphs have 40-80 words.
 * `regions: true` wraps the content in nested regions: parts (section-1) > chapters (section-2) > scenes (section-3), ~200 in total.
 */

const WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ' +
  'the quick brown fox jumps over lazy dog river ferryman bank water night morning window letter silence road door lamp winter garden ' +
  'she said he walked slowly across empty street while rain kept falling on old stone houses and nobody answered when they called ' +
  'memory of summer returned with salt wind laughter bread table candle whisper shadow stairs voice ocean map paper clock train').split(' ');

/** mulberry32: small seeded PRNG so that every run builds the same document. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GenOptions {
  /** Total number of blocks (tree nodes, containers and their children included). */
  blocks: number;
  /** Wrap the content in ~200 nested regions (parts > chapters > scenes). */
  regions?: boolean;
  seed?: number;
}

export interface GenResult {
  doc: { version: string; blocks: any[] };
  /** Tree nodes, regions included. */
  nodes: number;
  /** Blocks that render a `[data-block-id]` element (nodes minus nothing: one element per node). */
  regions: number;
  words: number;
  chars: number;
}

export function genDoc({ blocks: target, regions = false, seed = 1 }: GenOptions): GenResult {
  const rand = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const words = (min: number, max: number) => {
    const n = min + Math.floor(rand() * (max - min + 1));
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(pick(WORDS));
    return out;
  };
  let nodes = 0, nRegions = 0, nWords = 0, nChars = 0;
  const count = (ws: string[]) => { nWords += ws.length; nChars += ws.join(' ').length; };
  const para = (type = 'paragraph') => {
    const ws = words(40, 80);
    count(ws);
    nodes++;
    if (rand() < 0.15) {
      // a marked run in the middle
      const a = Math.floor(ws.length / 3), b = a + 3;
      const runs: any[] = [{ text: ws.slice(0, a).join(' ') + ' ' }, { text: ws.slice(a, b).join(' '), [rand() < 0.5 ? 'bold' : 'italic']: true }, { text: ' ' + ws.slice(b).join(' ') }];
      return { type, content: runs };
    }
    return { type, content: [{ text: ws.join(' ') }] };
  };
  const heading = () => { const ws = words(3, 8); count(ws); nodes++; return { type: 'heading', props: { level: 1 + Math.floor(rand() * 3) }, content: [{ text: ws.join(' ') }] }; };
  const list = () => {
    nodes++;
    return { type: 'list', props: { listType: pick(['bullet', 'ordered']) }, children: [0, 1, 2].map(() => { const ws = words(6, 14); count(ws); nodes++; return { type: 'list-item', content: [{ text: ws.join(' ') }] }; }) };
  };
  const toggle = () => { const ws = words(3, 8); count(ws); nodes++; return { type: 'toggle', props: { collapsed: false }, content: [{ text: ws.join(' ') }], children: [para(), para()] }; };
  const code = () => { nodes++; const src = Array.from({ length: 8 }, (_, i) => `const value${i} = compute(${i}, 'x${i}'); // ${pick(WORDS)}`).join('\n'); nChars += src.length; return { type: 'code', props: { language: 'javascript' }, content: src }; };

  /** One block (or a small group) of the body, chosen by the running node count. */
  let sinceCode = 0;
  let lastWasList = false;
  const bodyBlock = (): any => {
    if (sinceCode >= 200) { sinceCode = 0; lastWasList = false; return code(); }
    const before = nodes;
    const r = rand();
    // never two lists in a row: the list normalizer merges adjacent lists of the same type when a document is imported
    const b = r < 0.10 ? heading() : r < 0.15 && !lastWasList ? list() : r < 0.17 ? toggle() : para();
    lastWasList = b.type === 'list';
    sinceCode += nodes - before;
    return b;
  };

  const out: any[] = [];
  if (!regions) {
    while (nodes < target) out.push(bodyBlock());
  } else {
    // ~200 regions: 8 parts > 5 chapters each (40) > 4 scenes each (160) = 208 regions. The body is spread over the scenes.
    const parts = 8, chapters = 5, scenes = 4;
    const total = parts * (1 + chapters * (1 + scenes));
    const perScene = Math.max(1, Math.floor((target - total) / (parts * chapters * scenes)));
    const region = (regionType: string, title: string, children: any[]) => { nodes++; nRegions++; const ws = title.split(' '); count(ws); return { type: 'region', props: { regionType, fields: {} }, content: [{ text: title }], children }; };
    for (let p = 0; p < parts; p++) {
      const chs: any[] = [];
      for (let c = 0; c < chapters; c++) {
        const scs: any[] = [];
        for (let s = 0; s < scenes; s++) {
          const body: any[] = [];
          const start = nodes;
          while (nodes - start < perScene) body.push(bodyBlock());
          scs.push(region('section-3', words(2, 4).join(' '), body));
        }
        const intro = [para()];
        chs.push(region('section-2', words(2, 4).join(' '), [...intro, ...scs]));
      }
      out.push(region('section-1', words(2, 4).join(' '), [para(), ...chs]));
    }
  }
  return { doc: { version: '1', blocks: out }, nodes, regions: nRegions, words: nWords, chars: nChars };
}

/** `n` blocks of markdown (blank-line separated paragraphs of 40-80 words, ~10% `## ` headings): a text/plain paste payload. */
export function genPasteMarkdown(n: number, seed = 7): string {
  const rand = rng(seed);
  const words = (min: number, max: number) => Array.from({ length: min + Math.floor(rand() * (max - min + 1)) }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(' ');
  return Array.from({ length: n }, (_, i) => (i % 10 === 3 ? `## ${words(3, 7)}` : words(40, 80))).join('\n\n');
}
