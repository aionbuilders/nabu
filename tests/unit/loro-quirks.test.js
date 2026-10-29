/**
 * Canary tests: they assert that Loro's RAW behaviour is still the surprising one that Nabu works around, using plain
 * loro-crdt and none of Nabu's code.
 *
 * A canary passes today. When it FAILS after a Loro upgrade, that is good news: Loro fixed the quirk, and the workaround named in
 * the message is now a no-op. Read the message, check the Loro changelog, then remove the workaround (and the canary with it) or
 * keep it as a harmless guard, and say so in the CHANGELOG. Do not "fix" a canary by changing its expectation.
 */

import { describe, it, expect } from 'vitest';
import { LoroDoc } from 'loro-crdt';

describe('Loro quirks (canaries)', () => {
  // https://github.com/loro-dev/loro/issues/1240
  it('#1240 (shape 2): an insert at the left edge of an unmarked hole takes the outer mark', () => {
    const doc = new LoroDoc();
    doc.configTextStyle({ bold: { expand: 'none' } });
    const text = doc.getText('t');
    text.insert(0, '0123456789');
    text.mark({ start: 0, end: 10 }, 'bold', true);
    text.unmark({ start: 3, end: 7 }, 'bold');
    text.insert(3, 'X');
    doc.commit();
    const marksOfX = text.sliceDelta(3, 4)[0].attributes?.bold;
    expect(
      marksOfX,
      'Loro fixed #1240 (insert at the left edge of an unmarked hole takes the outer mark). The mark-edge correction in the text behavior insert path is now a no-op and can be removed.',
    ).toBe(true);
  });

  it('the raw toDelta keeps a split after a mark removed over exactly its own range', () => {
    // https://github.com/loro-dev/loro/issues/1241
    const doc = new LoroDoc();
    doc.configTextStyle({ bold: { expand: 'none' } });
    const text = doc.getText('t');
    text.insert(0, 'The ford is upstream.');
    text.mark({ start: 18, end: 21 }, 'bold', true);
    text.unmark({ start: 18, end: 21 }, 'bold');
    doc.commit();
    expect(
      text.toDelta().length,
      'Loro now merges equal adjacent runs after an exact unmark. normalizeDelta/readDelta in src/lib/utils/delta.js is now a no-op on these deltas and can be kept or removed.',
    ).toBe(2);
  });
});
