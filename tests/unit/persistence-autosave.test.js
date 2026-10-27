// @ts-nocheck
/**
 * ADR 010 (theme 8, P-96): debounce WITH a maximum wait — pure scheduler, fake clock. And the load / recovery decision (P-92), pure.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAutosave, resolveMaxWait, DEFAULT_MAX_WAIT } from '#lib/persistence/autosave.js';
import { resolveLoad, describeRecovery } from '#lib/persistence/recovery.js';

/** A scheduler driven by a virtual clock. */
function harness(options) {
  let t = 0;
  const run = vi.fn();
  const timers = new Set();
  const setTimer = (fn, ms) => { const timer = { fn, at: t + ms }; timers.add(timer); return timer; };
  const clearTimer = (timer) => timers.delete(timer);
  const autosave = createAutosave({ ...options, run, now: () => t, setTimer, clearTimer });
  /** Advance the clock, firing the timers that come due, in order. */
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      const due = [...timers].filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.delete(due);
      t = due.at;
      due.fn();
    }
    t = end;
  };
  return { autosave, run, advance, now: () => t };
}

describe('createAutosave — debounce with maxWait', () => {
  it('saves `debounce` ms after the last change', () => {
    const h = harness({ debounce: 2000, maxWait: Infinity });
    h.autosave.touch();
    h.advance(1999);
    expect(h.run).not.toHaveBeenCalled();
    h.advance(1);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.autosave.pending()).toBe(false);
  });

  it('each change re-arms the debounce (no maxWait: a burst is never saved — the old behaviour)', () => {
    const h = harness({ debounce: 400, maxWait: Infinity });
    for (let i = 0; i < 40; i++) { h.autosave.touch(); h.advance(150); }
    expect(h.run).not.toHaveBeenCalled();
    h.advance(400);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('a continuous burst is saved at least every maxWait ms', () => {
    const h = harness({ debounce: 400, maxWait: 1000 });
    const saves = [];
    h.run.mockImplementation(() => saves.push(h.now()));
    for (let i = 0; i < 40; i++) { h.autosave.touch(); h.advance(150); } // 6 s of typing, every 150 ms
    expect(saves[0]).toBe(1000); // the first save: maxWait after the FIRST change
    expect(saves.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < saves.length; i++) expect(saves[i] - saves[i - 1]).toBeLessThanOrEqual(1000 + 150);
    h.advance(400);
    expect(h.autosave.pending()).toBe(false); // the tail is saved after the pause
  });

  it('a new burst starts after a save (the max wait is counted from its first change)', () => {
    const h = harness({ debounce: 100, maxWait: 1000 });
    h.autosave.touch(); h.advance(100);
    expect(h.run).toHaveBeenCalledTimes(1);
    h.advance(5000); // a long silence
    h.autosave.touch();
    for (let i = 0; i < 8; i++) { h.advance(90); h.autosave.touch(); }
    expect(h.run).toHaveBeenCalledTimes(1); // 720 ms into the burst: not yet
    h.advance(280);
    expect(h.run).toHaveBeenCalledTimes(2); // 1000 ms after the first change of the burst
  });

  it('cancel() drops the pending save and the burst', () => {
    const h = harness({ debounce: 100, maxWait: 300 });
    h.autosave.touch();
    expect(h.autosave.pending()).toBe(true);
    h.autosave.cancel();
    expect(h.autosave.pending()).toBe(false);
    h.advance(1000);
    expect(h.run).not.toHaveBeenCalled();
    h.advance(1000); h.autosave.touch(); h.advance(100); // a fresh burst after a cancel
    expect(h.run).toHaveBeenCalledTimes(1);
  });
});

describe('resolveMaxWait', () => {
  it('defaults to 3000 ms, never shorter than the debounce', () => {
    expect(DEFAULT_MAX_WAIT).toBe(3000);
    expect(resolveMaxWait(undefined, 2000)).toBe(3000);
    expect(resolveMaxWait(undefined, 5000)).toBe(5000);
    expect(resolveMaxWait(1000, 400)).toBe(1000);
    expect(resolveMaxWait(100, 400)).toBe(400);
  });
  it('0 / Infinity / invalid: no maximum', () => {
    for (const v of [0, Infinity, -5, NaN, null, 'soon']) expect(resolveMaxWait(v, 2000)).toBe(Infinity);
  });
});

describe('resolveLoad — what to open from what is stored', () => {
  const rec = (name) => ({ docId: 'd', snapshot: name, savedAt: 1 });
  const load = (snapshot) => { if (String(snapshot).startsWith('bad')) throw new Error(`cannot import ${snapshot}`); return `doc:${snapshot}`; };

  it('nothing stored: a new document', () => {
    expect(resolveLoad({ current: null, backup: null }, load)).toMatchObject({ outcome: 'new', value: null, used: null, failed: [] });
  });
  it('a readable snapshot: loaded, the backup is not even tried', () => {
    const spy = vi.fn(load);
    const d = resolveLoad({ current: rec('good'), backup: rec('older') }, spy);
    expect(d).toMatchObject({ outcome: 'ok', value: 'doc:good', failed: [] });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('a database without backup (older version) loads as before', () => {
    expect(resolveLoad({ current: rec('good'), backup: null }, load).outcome).toBe('ok');
  });
  it('an unreadable snapshot: the backup is used, the bad record is reported', () => {
    const d = resolveLoad({ current: rec('bad1'), backup: rec('older') }, load);
    expect(d.outcome).toBe('backup');
    expect(d.value).toBe('doc:older');
    expect(d.used.snapshot).toBe('older');
    expect(d.failed).toHaveLength(1);
    expect(d.failed[0]).toMatchObject({ source: 'snapshot' });
    expect(d.failed[0].error.message).toMatch(/bad1/);
  });
  it('both unreadable: empty, both reported', () => {
    const d = resolveLoad({ current: rec('bad1'), backup: rec('bad2') }, load);
    expect(d).toMatchObject({ outcome: 'empty', value: null, used: null });
    expect(d.failed.map((f) => f.source)).toEqual(['snapshot', 'backup']);
  });
  it('unreadable snapshot and no backup: empty', () => {
    expect(resolveLoad({ current: rec('bad1'), backup: null }, load)).toMatchObject({ outcome: 'empty' });
  });
  it('the snapshot is missing but a backup exists: the backup is used (odd state, not silent)', () => {
    const d = resolveLoad({ current: null, backup: rec('older') }, load);
    expect(d).toMatchObject({ outcome: 'backup', failed: [] });
    expect(describeRecovery(d, [], 5)).toMatchObject({ kind: 'backup', quarantinedKey: null, at: 5 });
  });
  it('a thrown non-Error is wrapped in an Error', () => {
    const d = resolveLoad({ current: rec('x'), backup: null }, () => { throw 'boom'; });
    expect(d.failed[0].error).toBeInstanceOf(Error);
    expect(d.failed[0].error.message).toBe('boom');
  });

  describe('describeRecovery', () => {
    it('null when nothing went wrong', () => {
      expect(describeRecovery(resolveLoad({ current: rec('good'), backup: null }, load), [], 1)).toBeNull();
      expect(describeRecovery(resolveLoad({ current: null, backup: null }, load), [], 1)).toBeNull();
    });
    it('kind, error of the latest snapshot, key of its quarantined copy', () => {
      const d = resolveLoad({ current: rec('bad1'), backup: rec('bad2') }, load);
      const r = describeRecovery(d, ['d@9', 'd@9-backup'], 9);
      expect(r).toMatchObject({ kind: 'empty', quarantinedKey: 'd@9', quarantinedKeys: ['d@9', 'd@9-backup'], at: 9 });
      expect(r.error.message).toMatch(/bad1/);
      expect(describeRecovery(resolveLoad({ current: rec('bad1'), backup: rec('ok') }, load), ['d@9'], 9)).toMatchObject({ kind: 'backup', quarantinedKey: 'd@9' });
    });
  });
});
