// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  classify, eraOf, countEras, significantLines, keptLines, computeShares, parseLog, subjectOf, buildHistory, BASELINE, CURATED, ERA_BOUNDARY,
} from '../../scripts/history.js';
import { ledgerRows, ledgerNote, strata, monthName, dayMonth, STEERING } from '../../src/site/architecture/made.js';

// The data of "How Nabu is made": the pure parts of scripts/history.js (which commits are K. and which C., the eras, the line shares) and of
// src/site/architecture/made.js (the rows and sentences made from history.json). jj itself is not run here: the build and the tests never need it.

const history = JSON.parse(readFileSync('src/site/architecture/history.json', 'utf8'));

describe('classify: K. or C.', () => {
  it('is C when the message carries a Co-Authored-By: Claude trailer, whatever the model name', () => {
    expect(classify('feat: x\n\nbody\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')).toBe('C');
    expect(classify('feat: x\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\n')).toBe('C');
    expect(classify('feat: x\n\nco-authored-by: claude <noreply@anthropic.com>')).toBe('C');
  });
  it('is C when the author is Anthropic’s address, with no trailer at all', () => {
    expect(classify('feat: x', 'noreply@anthropic.com')).toBe('C');
    expect(classify('feat: x', 'Claude@Anthropic.com')).toBe('C');
    expect(classify('feat: x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>', 'noreply@anthropic.com')).toBe('C');
  });
  it('is K when neither mark is there: another address, a look-alike domain, no email', () => {
    expect(classify('feat: x', 'killian.divincenzo@gmail.com')).toBe('K');
    expect(classify('feat: x', 'noreply@anthropic.com.evil.example')).toBe('K');
    expect(classify('feat: x', 'noreply@notanthropic.com')).toBe('K');
    expect(classify('feat: x', '')).toBe('K');
    expect(classify('feat: x')).toBe('K');
  });
  it('is K without it, also when the word Claude appears elsewhere or the co-author is someone else', () => {
    expect(classify('feat: x')).toBe('K');
    expect(classify('')).toBe('K');
    expect(classify('fix: ask Claude less\n\nCo-Authored-By: Someone Else <a@b.c>')).toBe('K');
    expect(classify('Mentions Co-Authored-By: Claude in the middle of a sentence')).toBe('K');
  });
});

describe('eras', () => {
  it('cuts at the first of October', () => {
    expect(eraOf('2026-06-11')).toBe('before');
    expect(eraOf('2026-09-30')).toBe('before');
    expect(eraOf(ERA_BOUNDARY)).toBe('since');
    expect(eraOf('2026-10-28')).toBe('since');
  });
  it('counts each era; a commit authored by Anthropic without the trailer is C', () => {
    const e = (date, description, email = 'me@x.fr') => ({ id: date, commit: 'c', date, committerDate: date, email, description });
    const eras = countEras([
      e('2026-02-18', 'init'),
      e('2026-03-15', 'by claude web', 'noreply@anthropic.com'),
      e('2026-06-11', 'beta\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>'),
      e('2026-10-08', 'x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'),
      e('2026-10-09', 'y\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'),
    ]);
    expect(eras.before).toEqual({ total: 3, k: 1, c: 2, claudeAuthoredUnsigned: 1, from: '2026-02-18', to: '2026-06-11' });
    expect(eras.since).toEqual({ total: 2, k: 0, c: 2, claudeAuthoredUnsigned: 0, from: '2026-10-08', to: '2026-10-09' });
  });
});

describe('line shares', () => {
  it('compares trimmed, non-blank lines', () => {
    expect(significantLines('  a\n\n\tb  \r\n   \nc')).toEqual(['a', 'b', 'c']);
  });
  it('keeps a line once per occurrence that is still there (multiset), in any order', () => {
    expect(keptLines(['a', 'b', 'c'], ['c', 'a', 'x'])).toBe(2);
    expect(keptLines(['}', '}', '}'], ['}', 'x', '}'])).toBe(2);
    expect(keptLines(['a'], [])).toBe(0);
    expect(keptLines([], ['a'])).toBe(0);
  });
  it('is computed file by file: a file that is gone or renamed keeps nothing, a new file is all new', () => {
    const baseline = { 'src/lib/a.js': 'one\ntwo\nthree\nfour', 'src/lib/gone.js': 'x\ny', 'src/lib/old-name.js': 'same\nsame' };
    const today = { 'src/lib/a.js': 'one\ntwo\n  three  \nNEW\nNEW2', 'src/lib/new-name.js': 'same\nsame', 'src/lib/b.js': 'n1\nn2\nn3' };
    const s = computeShares(baseline, today);
    expect(s.files).toEqual({ baseline: 3, today: 3, shared: 1 });
    expect(s.lines).toEqual({ baseline: 8, today: 10, kept: 3 });
    expect(s.layers).toEqual({ before: 30, since: 70 });
    expect(s.keptOfBaseline).toBe(38);
  });
  it('the two layers always add up to 100', () => {
    for (const [kept, total] of [[1, 3], [2, 3], [6456, 25409], [0, 5], [5, 5]]) {
      const s = computeShares({ f: Array(kept).fill('k').join('\n') || '' }, { f: Array(kept).fill('k').concat(Array(total - kept).fill('n')).map((l, i) => (l === 'n' ? `n${i}` : l)).join('\n') });
      expect(s.layers.before + s.layers.since).toBe(100);
    }
    expect(computeShares({}, {}).layers).toEqual({ before: 0, since: 100 });
  });
});

describe('the log', () => {
  it('parses one JSON object per line and takes the first line of a message as the subject', () => {
    const entries = parseLog('{"id":"a","commit":"b","date":"2026-02-18","committerDate":"2026-02-18","email":"x@y.z","description":"feat: x\\n\\nbody\\n"}\n\n{"id":"c","commit":"d","date":"2026-02-19","committerDate":"2026-02-19","email":"x@y.z","description":"fix: y"}\n');
    expect(entries.map((e) => e.id)).toEqual(['a', 'c']);
    expect(subjectOf(entries[0].description)).toBe('feat: x');
  });
  it('refuses a curated commit that is not in the log, a missing baseline, and a gap that is not empty', () => {
    const e = (id, date) => ({ id, commit: id, date, committerDate: date, email: 'k@x.fr', description: `s ${id}` });
    const all = [...CURATED, BASELINE].map((id, i) => e(id, `2026-02-${String(10 + (i % 15)).padStart(2, '0')}`));
    expect(() => buildHistory(all.slice(1), {}, {})).toThrow(/curated commit|baseline/);
    expect(() => buildHistory([...all, e('zzz', '2026-08-15')], {}, {})).toThrow(/nothing/);
  });
});

describe('history.json (what the page reads)', () => {
  it('is consistent', () => {
    expect(history.baseline.id).toBe(BASELINE);
    expect(history.total).toBe(history.eras.before.total + history.eras.since.total);
    for (const era of Object.values(history.eras)) expect(era.k + era.c).toBe(era.total);
    expect(history.shares.layers.before + history.shares.layers.since).toBe(100);
    expect(history.shares.lines.kept).toBeLessThanOrEqual(history.shares.lines.baseline);
    expect(history.shares.lines.kept).toBeLessThanOrEqual(history.shares.lines.today);
    expect(history.curated.map((c) => c.id)).toEqual(CURATED);
    expect(history.gap.commits).toBe(0);
  });
  it('has only commits that the rule agrees with: a curated commit is C exactly as its era says', () => {
    for (const c of history.curated) expect(['K', 'C']).toContain(c.who);
    const dates = history.curated.map((c) => c.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('the rows and the sentences of the page', () => {
  it('lists the commits in order, the steering lines after their commits, the gap between the eras', () => {
    const rows = ledgerRows(history);
    expect(rows.filter((r) => r.kind === 'commit').map((r) => r.id)).toEqual(CURATED);
    expect(rows.filter((r) => r.kind === 'steer').map((r) => r.text)).toEqual(Object.values(STEERING));
    expect(rows.filter((r) => r.kind === 'gap')).toEqual([{ kind: 'gap', text: 'July, August, September: nothing.' }]);
    for (const [i, r] of rows.entries()) if (r.kind === 'steer') expect(rows[i - 1]).toMatchObject({ kind: 'commit', id: r.after });
    const gap = rows.findIndex((r) => r.kind === 'gap');
    expect(rows[gap - 1].date < history.boundary).toBe(true);
    expect(rows[gap + 1].date >= history.boundary).toBe(true);
  });
  it('writes the three steering lines exactly as the board does', () => {
    expect(Object.values(STEERING)).toEqual(['“No. Regions are boxes in Loro. Markers only on screen.”', '“It’s not that clean… it’s heavy. Don’t you think?”', '“Okay, go for 0.1.0.”']);
  });
  it('writes the note from the data, with the rule and without a placeholder', () => {
    const [excerpt, counts, rule] = ledgerNote(history);
    expect(excerpt).toContain('translated from French and condensed');
    expect(counts).toContain(`From February to June: ${history.eras.before.k} commits by Killian, ${history.eras.before.c} by Claude`);
    expect(counts).toContain('authored by Claude Code on GitHub');
    expect(counts).toContain('was co-signed');
    expect(counts).toContain(`all ${history.eras.since.total} commits are co-signed by Claude`);
    expect(rule).toContain('Co-Authored-By: Claude');
    expect(rule).toContain('Anthropic’s address');
    expect(rule).toContain('does not prove that no AI was used');
    expect(rule).not.toMatch(/early commits have/);
    expect([excerpt, counts, rule].join(' ')).not.toMatch(/[[\]]/);
  });
  it('draws the two layers from the shares, named by the months of the data', () => {
    const s = strata(history);
    expect(s.layers.map((l) => l.percent)).toEqual([history.shares.layers.since, history.shares.layers.before]);
    expect(s.layers[1].title).toBe('February – June');
    expect(s.label).toContain(`${history.shares.layers.since}%`);
    expect(s.caption).toContain('a line that moved counts as new');
  });
  it('formats dates', () => {
    expect(monthName('2026-02-18')).toBe('February');
    expect(dayMonth('2026-06-11')).toBe('11 June');
  });
});
