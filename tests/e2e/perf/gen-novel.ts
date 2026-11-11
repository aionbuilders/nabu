/**
 * Deterministic generator of a NOVEL: the shape that made WebKit slow on large documents (nested regions, long text). Same recipe as
 * the owner's bench (orduin desktop/bench/nabu-novel/gen-novel.mjs), but it builds the `serialize('json')` tree (what `seedSnapshot`
 * stores) and uses the region types of the /e2e page: a prologue (section-1) of 12 paragraphs, then 3 parts (section-1) > chapters
 * (section-2, one per ~3,000 words) > 2-4 scenes (section-3) of paragraphs (30% short dialogue lines, 66% of 20-60 words, 4% of 120-240).
 */

import { rng } from './gen-doc.js';

const WORDS = ('le la les un une des de du et à en dans sur sous avec sans pour par elle il ils elles nous vous je tu on ne pas plus jamais toujours déjà encore ' +
  'maison fenêtre rue pluie nuit matin lumière silence mère père frère sœur enfant femme homme porte escalier jardin rivière pont gare train lettre ' +
  'regard main visage voix souvenir été hiver vent mer sel pain table bougie ombre chemin village église cloche champ forêt route voiture café ' +
  'dit répondit murmura marcha ouvrit ferma attendit pensa regarda sourit comprit oublia revint partit tomba écouta savait voulait pouvait ' +
  "lentement doucement soudain pourtant alors comme quand pendant depuis avant après toujours quelque chose rien personne quelqu'un " +
  'vieux petit grand long noir blanc froid chaud lourd vide ancien dernier premier seul entier fatigué étrange').split(' ');

export interface NovelResult {
  doc: { version: string; blocks: any[] };
  /** Tree nodes (regions and paragraphs). */
  nodes: number;
  words: number;
  paragraphs: number;
  chapters: number;
  scenes: number;
}

export function genNovel(targetWords: number, seed = 7): NovelResult {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const sentence = (n: number) => {
    const ws = Array.from({ length: n }, () => pick(WORDS));
    ws[0] = ws[0][0].toUpperCase() + ws[0].slice(1);
    return ws.join(' ') + '.';
  };
  const text = (n: number) => {
    const out: string[] = [];
    for (let left = n; left > 0;) { const k = Math.min(left, 6 + Math.floor(r() * 14)); out.push(sentence(k)); left -= k; }
    return out.join(' ');
  };
  let words = 0, paragraphs = 0, nodes = 0, chapters = 0, scenes = 0;
  const para = () => {
    const x = r();
    let n: number, s: string;
    if (x < 0.30) { n = 2 + Math.floor(r() * 6); s = '« ' + sentence(n).replace(/\.$/, ' !') + ' »'; }
    else if (x < 0.96) { n = 20 + Math.floor(r() * 41); s = text(n); }
    else { n = 120 + Math.floor(r() * 120); s = text(n); }
    words += n; paragraphs++; nodes++;
    return { type: 'paragraph', content: [{ text: s }] };
  };
  const title = () => { const t = Array.from({ length: 2 + Math.floor(r() * 3) }, () => pick(WORDS)).join(' '); return t[0].toUpperCase() + t.slice(1); };
  const region = (regionType: string, t: string, children: any[]) => { nodes++; return { type: 'region', props: { regionType, fields: {} }, content: [{ text: t }], children }; };

  const nChapters = Math.round(targetWords / 3000), perPart = Math.ceil(nChapters / 3), wordsPerChapter = targetWords / nChapters;
  const blocks: any[] = [region('section-1', 'Prologue', Array.from({ length: 12 }, para))];
  for (let p = 0; p < 3; p++) {
    const chs: any[] = [];
    for (let c = 0; c < perPart && chapters < nChapters; c++, chapters++) {
      const ns = 2 + Math.floor(r() * 3), budget = wordsPerChapter / ns, scs: any[] = [];
      for (let s = 0; s < ns; s++, scenes++) {
        const body: any[] = [], start = words;
        while (words - start < budget) body.push(para());
        scs.push(region('section-3', title(), body));
      }
      chs.push(region('section-2', title(), scs));
    }
    blocks.push(region('section-1', title(), chs));
  }
  return { doc: { version: '1', blocks }, nodes, words, paragraphs, chapters, scenes };
}
