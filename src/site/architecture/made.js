/**
 * The words and the shapes of "How Nabu is made" (`/architecture/how-it-is-made`). The numbers, the dates and the commit subjects are
 * NOT written here: they come from `history.json`, which `scripts/history.js` (`bun run history`) reads from the repository history.
 * What is here is the human text of the page and the pure functions that turn that data into rows and sentences (unit-tested in
 * tests/unit/site-made.test.js). Wording follows the design board (HowMadeE); the owner's essay lives in docs/architecture/how-it-is-made.{en,fr}.md.
 */
import { REPO_URL } from '../docs/content.js';

export const MADE_TITLE = 'How Nabu is made · Architecture · Nabu';
export const MADE_DESCRIPTION =
  'Nabu is built by one person and an AI. The share of the library each layer wrote, the real commit log, and Killian’s own words on how it went.';
export const MADE_PATH = '/architecture/how-it-is-made';
export const ESSAY_FILES = { en: 'docs/architecture/how-it-is-made.en.md', fr: 'docs/architecture/how-it-is-made.fr.md' };

export const MADE_LEAD =
  'A palimpsest is a page scraped and written again, the first text still showing through. Nabu is built by one person and an AI. This is how the two layers fit.';

/** The moments where he steered: a large line shown right AFTER the commit with this change id. Typography is the board's. */
export const STEERING = /** @type {Record<string, string>} */ ({
  ppknsxml: '“No. Regions are boxes in Loro. Markers only on screen.”',
  prywxnst: '“It’s not that clean… it’s heavy. Don’t you think?”',
  ytltxpwu: '“Okay, go for 0.1.0.”',
});

export const WHO = {
  K: { letter: 'K.', name: 'Killian' },
  C: { letter: 'C.', name: 'Claude' },
};

/** @param {number} n */
export const group = (n) => n.toLocaleString('en-US');

/** `2026-02-18` -> `February` @param {string} date */
export const monthName = (date) => new Date(`${date}T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

/** The two layers of the figure, top first. `history` is history.json. @param {any} history */
export function strata(history) {
  const { before, since } = history.eras;
  const { layers, lines, files } = history.shares;
  return {
    layers: [
      { id: 'since', title: 'Since October', detail: 'with Claude · regions, persistence, chunks, a11y, read-only, the site', percent: layers.since },
      { id: 'before', title: `${monthName(before.from)} – ${monthName(before.to)}`, detail: 'before October · the engine, the selection bridge, the first blocks, undo', percent: layers.before },
    ],
    label: `Today’s library, by line: ${layers.since}% written since October, ${layers.before}% still unchanged from before October (${group(lines.kept)} of ${group(lines.today)} lines).`,
    caption: `Today’s library (src/lib), by line: ${group(lines.today)} lines in ${files.today} files. The bottom layer is what was already there at ${history.baseline.subject.replace(/^feat: beta milestone \((.*)\)$/, '$1')} and is still there, unchanged: ${group(lines.kept)} lines. The top layer is everything written since. Rough count from the repository history: files are compared one by one and a line that moved counts as new. That beta commit was itself co-signed by Claude, so “before October” is not the same as “by hand”.`,
  };
}

/**
 * The rows of the ledger, in order: the commits, a large line after the commits that have one, and the gap between two eras.
 * @param {any} history
 * @returns {Array<{ kind: 'commit', id: string, date: string, who: 'K' | 'C', subject: string } | { kind: 'steer', after: string, text: string } | { kind: 'gap', text: string }>}
 */
export function ledgerRows(history) {
  /** @type {any[]} */
  const rows = [];
  /** @type {any[]} */
  const items = history.curated;
  items.forEach((c, i) => {
    rows.push({ kind: 'commit', id: c.id, date: c.date, who: c.who, subject: c.subject });
    if (STEERING[c.id]) rows.push({ kind: 'steer', after: c.id, text: STEERING[c.id] });
    const next = items[i + 1];
    if (next && c.date < history.boundary && next.date >= history.boundary) rows.push({ kind: 'gap', text: `${history.gap.label}: nothing.` });
  });
  return rows;
}

/**
 * The note under the ledger, as sentences: the counts come from the data, nothing is rounded up. The rule that makes a commit a C. is said
 * out loud, with what it does not prove.
 * @param {any} history
 * @returns {string[]}
 */
export function ledgerNote(history) {
  const { before, since } = history.eras;
  const months = `${monthName(before.from)} to ${monthName(before.to)}`;
  const beta = history.baseline.subject.replace(/^feat: beta milestone \((.*)\)$/, '$1');
  const first = before.c
    ? `From ${months}: ${before.k} commits by Killian, ${before.c} by Claude (co-signed, or authored by Claude Code on GitHub). The ${beta} commit, authored ${dayMonth(history.baseline.date)}, was co-signed.`
    : `From ${months}: ${before.k} commits by Killian.`;
  const second = since.k ? `Since October, ${since.c} of ${since.total} commits are co-signed by Claude.` : `Since October, all ${since.total} commits are co-signed by Claude.`;
  const rule = 'A commit counts as C. when its message carries a “Co-Authored-By: Claude” line, or when Anthropic’s address is its author (Claude Code on GitHub). That records a choice made at commit time, not who wrote what, and a commit without these marks does not prove that no AI was used.';
  return ['An excerpt. His lines are translated from French and condensed.', `Counts from the repository history: ${first} ${second}`, rule];
}

/** `2026-06-11` -> `11 June` @param {string} date */
export const dayMonth = (date) => `${Number(date.slice(8, 10))} ${monthName(date)}`;

export const logUrl = `${REPO_URL}/commits/main`;
