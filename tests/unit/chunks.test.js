// @ts-nocheck
/**
 * The chunking of long block lists (blocks/chunks.js): cuts by CONTENT (a hash of the block id), so that an edit moves at most the
 * cut it makes, never the ones after it.
 */
import { describe, it, expect } from 'vitest';
import { chunkBlocks, startsChunk, CHUNK_AVG, CHUNK_ON, CHUNK_OFF, LARGE_DOC } from '#lib/blocks/chunks.js';

/** Blocks as far as the chunker is concerned: an id. Ids look like Loro tree ids (`counter@peer`). */
const make = (n, peer = '14992621316530441114', from = 0) => Array.from({ length: n }, (_, i) => ({ id: `${from + i}@${peer}` }));

describe('chunkBlocks', () => {
  it('keeps every block, once, in order', () => {
    const blocks = make(3000);
    const chunks = chunkBlocks(blocks);
    expect(chunks.flatMap((c) => c.blocks)).toEqual(blocks);
    expect(chunks.every((c) => c.blocks.length > 0)).toBe(true);
  });

  it('keys a chunk by its first block, and starts one at the first block whatever its id', () => {
    const blocks = make(500);
    const chunks = chunkBlocks(blocks);
    expect(chunks[0].blocks[0]).toBe(blocks[0]);
    for (const c of chunks) expect(c.key).toBe(c.blocks[0].id);
    for (const c of chunks.slice(1)) expect(startsChunk(c.key)).toBe(true);
    // ...and no cut inside a chunk
    for (const c of chunks) for (const b of c.blocks.slice(1)) expect(startsChunk(b.id)).toBe(false);
  });

  it('cuts about every CHUNK_AVG blocks', () => {
    for (const peer of ['1', '14992621316530441114', '777']) {
      const n = 20000;
      const chunks = chunkBlocks(make(n, peer));
      const avg = n / chunks.length;
      expect(avg).toBeGreaterThan(CHUNK_AVG * 0.6);
      expect(avg).toBeLessThan(CHUNK_AVG * 1.6);
    }
  });

  it('is deterministic', () => {
    const blocks = make(2000);
    expect(chunkBlocks(blocks).map((c) => c.key)).toEqual(chunkBlocks(blocks.slice()).map((c) => c.key));
  });

  it('an insertion or a deletion changes at most the chunks around it: every chunk before and after is the same object', () => {
    const blocks = make(5000);
    const memo = new Map(chunkBlocks(blocks).map((c) => [c.key, c]));
    const total = memo.size;
    for (const at of [0, 1, 777, 2500, 4999]) {
      const inserted = blocks.slice(0, at).concat([{ id: `9999999@14992621316530441114` }], blocks.slice(at));
      const after = chunkBlocks(inserted, memo);
      const reused = after.filter((c) => memo.get(c.key) === c).length;
      expect(after.length).toBeGreaterThanOrEqual(total - 1);
      expect(reused).toBeGreaterThanOrEqual(total - 3);
      const removed = blocks.slice(0, at).concat(blocks.slice(at + 1));
      const gone = chunkBlocks(removed, memo);
      expect(gone.filter((c) => memo.get(c.key) === c).length).toBeGreaterThanOrEqual(total - 3);
    }
  });

  it('hands back the previous chunk object when its blocks are the same, a new one when they are not', () => {
    const blocks = make(1000);
    const first = chunkBlocks(blocks);
    const memo = new Map(first.map((c) => [c.key, c]));
    const again = chunkBlocks(blocks.slice(), memo);
    again.forEach((c, i) => expect(c).toBe(first[i]));
    const swapped = blocks.slice();
    [swapped[10], swapped[11]] = [swapped[11], swapped[10]];
    const next = chunkBlocks(swapped, memo);
    expect(next.flatMap((c) => c.blocks)).toEqual(swapped);
  });

  it('an empty list has no chunk', () => {
    expect(chunkBlocks([])).toEqual([]);
  });

  it('the switch-on and switch-off sizes leave room for a hysteresis, and a document is large well after a list is chunked', () => {
    expect(CHUNK_OFF).toBeLessThan(CHUNK_ON);
    expect(CHUNK_ON).toBeGreaterThan(CHUNK_AVG * 4);
    expect(LARGE_DOC).toBeGreaterThan(CHUNK_ON);
  });
});
