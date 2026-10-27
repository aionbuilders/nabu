import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as C from '../../src/site/brand/construction.js';
import { lockupLight, lockupDark, lockupMono, mark, classed, inner, decorative, viewBoxOf } from '../../src/site/brand/assets.js';
import { zip, crc32 } from '../../src/site/brand/zip.js';
import { FILES } from '../../src/site/brand/files.js';

describe('construction values match brand/source/build-logo.mjs', () => {
  const src = readFileSync('brand/source/build-logo.mjs', 'utf8');

  it('the constants the drawing cites are the ones of the generator', () => {
    expect(src).toMatch(/const A = 100;/);
    expect(src).toMatch(/const SCALE = 1\.2;/);
    expect(src).toMatch(/const GAP = 0\.3;/);
    expect(C.ASCENDER).toBe(100);
    expect(C.MARK_SCALE).toBe(1.2);
    expect(C.GAP).toBe(0.3);
  });

  it('they reproduce the shipped SVG: mark top, scale, gap, viewBox', () => {
    expect(C.MARK_TOP).toBeCloseTo(-95.653, 2);
    expect(lockupLight).toContain(`translate(0 ${C.MARK_TOP.toFixed(3)})`);
    expect(lockupLight).toContain(`scale(${(C.MARK_HEIGHT / 74).toFixed(5)})`);
    // the "n" starts at mark width + gap: the first word coordinate is 198.16
    expect(C.WORD_X).toBeCloseTo(198.16, 2);
    expect(lockupLight).toContain(`d="M${C.WORD_X.toFixed(2)} 0`);
    // the viewBox starts at the ascender
    expect(viewBoxOf(lockupLight).split(' ').map(Number)[1]).toBeCloseTo(C.ASCENDER_Y, 2);
    // the mark is centred on the x-height / 2 line
    expect(C.MARK_TOP + C.MARK_HEIGHT / 2).toBeCloseTo(C.X_CENTRE, 2);
    // the x-height is where the stem of the "n" ends
    expect(lockupLight).toContain(`L216.81${(-C.X_HEIGHT).toFixed(2)}`);
  });
});

describe('brand assets', () => {
  it('the three lockups and the mark are the real files', () => {
    for (const [svg, file] of [[lockupLight, 'nabu-logo-light.svg'], [lockupDark, 'nabu-logo-dark.svg'], [lockupMono, 'nabu-logo-mono.svg'], [mark, 'nabu-mark.svg']]) {
      expect(svg, file).toBe(readFileSync(`brand/${file}`, 'utf8'));
    }
  });

  it('classed() swaps the two fills for classes and keeps the paths; without a label it is decorative', () => {
    const out = classed(lockupLight);
    expect(out).not.toMatch(/fill=/);
    expect(out).toContain('class="mark"');
    expect(out).toContain('class="word"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).not.toContain('aria-label');
    expect(classed(lockupLight, 'Nabu')).toContain('role="img" aria-label="Nabu"');
  });

  it('inner() drops only the outer tags; decorative() hides the SVG from assistive tech', () => {
    const body = inner(lockupLight);
    expect(body.startsWith('<path')).toBe(true);
    expect(body).not.toContain('</svg>');
    expect(decorative(mark)).toContain('aria-hidden="true"');
  });
});

describe('zip', () => {
  it('crc32 of "123456789" is the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a readable archive with every file stored intact', () => {
    const files = FILES.map((f) => ({ name: `nabu-brand/${f.name}`, data: new Uint8Array(readFileSync(`brand/${f.name}`)) }));
    const out = zip(files);
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    // end of central directory
    const eocd = out.length - 22;
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocd + 10, true)).toBe(files.length);
    let p = dv.getUint32(eocd + 16, true);
    for (const f of files) {
      expect(dv.getUint32(p, true)).toBe(0x02014b50);
      const crc = dv.getUint32(p + 16, true);
      const size = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const local = dv.getUint32(p + 42, true);
      expect(new TextDecoder().decode(out.subarray(p + 46, p + 46 + nameLen))).toBe(f.name);
      expect(size).toBe(f.data.length);
      expect(crc).toBe(crc32(f.data));
      expect(dv.getUint32(local, true)).toBe(0x04034b50);
      const dataAt = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      expect(out.subarray(dataAt, dataAt + size)).toEqual(f.data);
      p += 46 + nameLen;
    }
  });

  it('is deterministic', () => {
    const files = [{ name: 'a.txt', data: new TextEncoder().encode('a') }];
    expect(zip(files)).toEqual(zip(files));
  });
});
