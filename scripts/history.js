// @ts-nocheck  (build-time script and its test, not part of the library nor of the type-checked site; node types are not installed)
/**
 * Generates the data of the page "How Nabu is made" (`/architecture/how-it-is-made`): `src/site/architecture/history.json`.
 *
 *   jj log / jj file show --> this script --> history.json (committed) --> the page (SvelteKit load, prerender)
 *
 * Run by hand with `bun run history` (or `npm run history`) from the repo root, whenever the page should catch up with the history.
 * It needs `jj` and the full history of THIS clone; the build never does: the site build (Dokploy builds from a clone that may
 * have no history at all) reads only the committed JSON and never runs this script.
 *
 * What it writes:
 *   - `eras`    commits per era (before October 2026 / since), each split into K (Killian) and C (Claude). A commit counts as C.
 *               when its message contains `Co-Authored-By: Claude` OR its AUTHOR is Anthropic's address (`@anthropic.com`, Claude Code
 *               on GitHub, which leaves no trailer); else K. Neither mark is proof of who wrote what: the page says so.
 *               `claudeAuthoredUnsigned` counts, among the C, those that have only the author address and no trailer.
 *   - `curated` the excerpt of the ledger: the change ids listed in CURATED below, with their real date and subject from the log.
 *   - `shares`  the line shares of today's `src/lib` against the baseline commit (`0.1.0-beta.0`): for every file that exists at
 *               the baseline, the lines still present unchanged in today's version of the same file (multiset match, lines compared
 *               trimmed, blank lines ignored; a moved or renamed line counts as new). `layers.before` is the share of today's
 *               lines that come from the baseline, `layers.since` the rest.
 *
 * The pure parts (classification, eras, line matching) are exported and unit-tested (tests/unit/site-history.test.js).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HISTORY_PATH = resolve(ROOT, 'src/site/architecture/history.json');

/** The baseline: the `0.1.0-beta.0` commit (change id). The share of the strata is measured against its `src/lib`. */
export const BASELINE = 'lxrwvwpx';
/** Where the library lives. */
export const LIB_DIR = 'src/lib';
/** The file kinds of the library that are counted. */
export const LIB_EXTENSIONS = ['.js', '.ts', '.svelte', '.css'];
/** The first day of the second era: everything authored from here on is "since October". */
export const ERA_BOUNDARY = '2026-10-01';

/**
 * The excerpt of the ledger, oldest first (change ids). Subject and date come from the log, never from here. The "steering" lines
 * of the page sit after some of these (see `src/site/architecture/data.js`).
 */
export const CURATED = [
  'vmuvmktn', // Init + Base Relation Blocks + Loro System
  'lxxtlswo', // feat(engine): complete Phase 1 - Single CE, Selection Bridge & Structural Input
  'swomkqqm', // fix(selection): solve cursor jumping ...
  'qutkzyky', // feat(list): implement nested lists ...
  'txunwtzy', // feat: implement Loro-backed undo/redo system
  'lunuyntt', // prepare alpha publication + add presets system
  'mumyuttw', // feat: implement HtmlPasteExtension ...
  'lxrwvwpx', // feat: beta milestone (0.1.0-beta.0), the baseline
  'zznluswv', // fix(security): escape clipboard HTML ...
  'ppknsxml', // feat(markdown): CommonMark/GFM inline parser ...
  'oxrqtnku', // refactor!(regions): regions are containers in the Loro tree (ADR 018, lot A)
  'prywxnst', // perf(core): batch tree events ...
  'qoytxytv', // feat(site): website shell (direction B) ...
  'ytltxpwu', // fix(selection): several editors on one page ...
];

/** The months with no commit at all that the page says so about ("July, August, September: nothing."). Checked, not assumed. */
export const GAP = { from: '2026-07-01', to: '2026-09-30', label: 'July, August, September' };

// ---------------------------------------------------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------------------------------------------------

/** Does the message carry a `Co-Authored-By: Claude` trailer? @param {string} message */
export const hasClaudeTrailer = (message) => /^co-authored-by:\s*claude\b/im.test(message);
/** Is the author Anthropic's address (Claude Code on GitHub)? @param {string} [email] */
export const isAnthropicAuthor = (email = '') => /@anthropic\.com\s*$/i.test(email);

/**
 * "C" when the message carries a `Co-Authored-By: Claude` trailer OR the author's email ends with `@anthropic.com`, "K" otherwise.
 * @param {string} message the full commit message
 * @param {string} [email] the author's email
 * @returns {'K' | 'C'}
 */
export function classify(message, email = '') {
  return hasClaudeTrailer(message) || isAnthropicAuthor(email) ? 'C' : 'K';
}

/**
 * The era of an author date (`YYYY-MM-DD`).
 * @param {string} date
 * @returns {'before' | 'since'}
 */
export const eraOf = (date) => (date < ERA_BOUNDARY ? 'before' : 'since');

/**
 * @typedef {{ id: string, commit: string, date: string, committerDate: string, email: string, description: string }} LogEntry
 * @typedef {{ total: number, k: number, c: number, claudeAuthoredUnsigned: number, from: string | null, to: string | null }} EraCount
 */

/**
 * Commits per era. `claudeAuthoredUnsigned`: commits counted as C by their author's address alone (no trailer).
 * @param {LogEntry[]} entries
 * @returns {{ before: EraCount, since: EraCount }}
 */
export function countEras(entries) {
  /** @returns {EraCount} */
  const empty = () => ({ total: 0, k: 0, c: 0, claudeAuthoredUnsigned: 0, from: null, to: null });
  const eras = { before: empty(), since: empty() };
  for (const e of entries) {
    const era = eras[eraOf(e.date)];
    era.total++;
    if (classify(e.description, e.email) === 'C') {
      era.c++;
      if (!hasClaudeTrailer(e.description)) era.claudeAuthoredUnsigned++;
    } else era.k++;
    if (!era.from || e.date < era.from) era.from = e.date;
    if (!era.to || e.date > era.to) era.to = e.date;
  }
  return eras;
}

/**
 * The non-blank lines of a text, trimmed: what the share counts.
 * @param {string} text
 * @returns {string[]}
 */
export const significantLines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/**
 * How many of the lines of `before` are still present in `after`: a multiset intersection (a line present twice before and once
 * after is kept once). Order does not matter, so a function moved inside its file still counts as kept.
 * @param {string[]} before @param {string[]} after
 * @returns {number}
 */
export function keptLines(before, after) {
  /** @type {Map<string, number>} */
  const pool = new Map();
  for (const l of after) pool.set(l, (pool.get(l) ?? 0) + 1);
  let kept = 0;
  for (const l of before) {
    const n = pool.get(l) ?? 0;
    if (n > 0) {
      kept++;
      pool.set(l, n - 1);
    }
  }
  return kept;
}

/**
 * The line shares of a library against its baseline, file by file (the same path in both; a file that was renamed or deleted keeps
 * nothing, a new file is all new).
 * @param {Record<string, string>} baseline path -> text at the baseline
 * @param {Record<string, string>} today path -> text today
 */
export function computeShares(baseline, today) {
  let baselineLines = 0;
  let todayLines = 0;
  let kept = 0;
  let baselineFiles = 0;
  let todayFiles = 0;
  let sharedFiles = 0;
  for (const [path, text] of Object.entries(baseline)) {
    const lines = significantLines(text);
    baselineLines += lines.length;
    baselineFiles++;
    if (path in today) {
      sharedFiles++;
      kept += keptLines(lines, significantLines(today[path]));
    }
  }
  for (const text of Object.values(today)) {
    todayLines += significantLines(text).length;
    todayFiles++;
  }
  const before = todayLines ? kept / todayLines : 0;
  return {
    files: { baseline: baselineFiles, today: todayFiles, shared: sharedFiles },
    lines: { baseline: baselineLines, today: todayLines, kept },
    // the percentages of the two layers add up to 100 exactly
    layers: { before: Math.round(before * 100), since: 100 - Math.round(before * 100) },
    keptOfBaseline: baselineLines ? Math.round((kept / baselineLines) * 100) : 0,
  };
}

/**
 * Parse the output of {@link LOG_TEMPLATE}: one JSON object per line.
 * @param {string} text
 * @returns {LogEntry[]}
 */
export const parseLog = (text) =>
  text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

/** The first line of a message. @param {string} message */
export const subjectOf = (message) => message.split('\n', 1)[0].trim();

// ---------------------------------------------------------------------------------------------------------------------
// jj
// ---------------------------------------------------------------------------------------------------------------------

/** One JSON object per commit: jj escapes the strings for us. */
const LOG_TEMPLATE =
  '"{\\"id\\":" ++ change_id.short(8).escape_json() ++ ",\\"commit\\":" ++ commit_id.short(8).escape_json() ++ ",\\"date\\":" ++ author.timestamp().format("%Y-%m-%d").escape_json() ++ ",\\"committerDate\\":" ++ committer.timestamp().format("%Y-%m-%d").escape_json() ++ ",\\"email\\":" ++ stringify(author.email()).escape_json() ++ ",\\"description\\":" ++ description.escape_json() ++ "}\\n"';

/** @param {string[]} args */
const jj = (args) => execFileSync('jj', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** Every commit of the history up to the working copy, except the undescribed one jj keeps on top for the working copy (work in progress, not a record yet). @returns {LogEntry[]} */
function readLog() {
  const out = jj(['log', '--no-graph', '-r', '(root()..@) ~ description(exact:"")', '-T', LOG_TEMPLATE]);
  return parseLog(out);
}

/** @param {string} rev @returns {Record<string, string>} */
function readLib(rev) {
  const files = jj(['file', 'list', '-r', rev, LIB_DIR]).split('\n').filter((f) => LIB_EXTENSIONS.some((x) => f.endsWith(x)));
  return Object.fromEntries(files.map((f) => [f, jj(['file', 'show', '-r', rev, f])]));
}

// ---------------------------------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {LogEntry[]} entries
 * @param {Record<string, string>} baselineLib @param {Record<string, string>} todayLib
 */
export function buildHistory(entries, baselineLib, todayLib) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const baseline = byId.get(BASELINE);
  if (!baseline) throw new Error(`history: the baseline ${BASELINE} is not in the log`);

  const inGap = entries.filter((e) => e.date >= GAP.from && e.date <= GAP.to);
  if (inGap.length) throw new Error(`history: the page says "${GAP.label}: nothing", but ${inGap.length} commit(s) were authored then`);

  const curated = CURATED.map((id) => {
    const e = byId.get(id);
    if (!e) throw new Error(`history: curated commit ${id} is not in the log`);
    return { id, date: e.date, who: classify(e.description, e.email), subject: subjectOf(e.description) };
  });

  return {
    baseline: {
      id: baseline.id,
      commit: baseline.commit,
      subject: subjectOf(baseline.description),
      date: baseline.date,
      committedOn: baseline.committerDate,
      who: classify(baseline.description, baseline.email),
    },
    boundary: ERA_BOUNDARY,
    total: entries.length,
    eras: countEras(entries),
    gap: { label: GAP.label, commits: inGap.length },
    curated,
    shares: computeShares(baselineLib, todayLib),
  };
}

function main() {
  const entries = readLog();
  const history = buildHistory(entries, readLib(BASELINE), readLib('@'));
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');
  const { eras, shares } = history;
  console.log(`history.json: ${history.total} commits`);
  console.log(`  before October: ${eras.before.total} (K ${eras.before.k}, C ${eras.before.c}; ${eras.before.claudeAuthoredUnsigned} of the C by Anthropic's address alone)`);
  console.log(`  since October:  ${eras.since.total} (K ${eras.since.k}, C ${eras.since.c})`);
  console.log(`  src/lib: ${shares.lines.kept} of ${shares.lines.today} lines are from the baseline (${shares.layers.before}%); ${shares.keptOfBaseline}% of the baseline survives`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
