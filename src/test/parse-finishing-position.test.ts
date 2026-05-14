import { describe, expect, it } from 'vitest';
import { parseFinishingPosition } from '@/lib/scoring';

describe('parseFinishingPosition', () => {
  it('parses plain numeric positions', () => {
    expect(parseFinishingPosition('1')).toBe(1);
    expect(parseFinishingPosition('38')).toBe(38);
    expect(parseFinishingPosition('150')).toBe(150);
  });

  it('strips the T prefix on ties', () => {
    expect(parseFinishingPosition('T4')).toBe(4);
    expect(parseFinishingPosition('T38')).toBe(38);
    expect(parseFinishingPosition('T73')).toBe(73);
  });

  it('sorts cut / withdrawn / disqualified after every real position but before unknown', () => {
    const cut = parseFinishingPosition('CUT');
    const wd = parseFinishingPosition('WD');
    const real = parseFinishingPosition('T155');
    expect(cut).toBeGreaterThan(real);
    expect(wd).toBeGreaterThan(real);
    expect(cut).toBeLessThan(Number.POSITIVE_INFINITY);
  });

  it('returns Infinity for null / empty / unparseable', () => {
    expect(parseFinishingPosition(null)).toBe(Number.POSITIVE_INFINITY);
    expect(parseFinishingPosition(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(parseFinishingPosition('')).toBe(Number.POSITIVE_INFINITY);
    expect(parseFinishingPosition('???')).toBe(Number.POSITIVE_INFINITY);
  });

  it('produces the right ascending sort order across a mixed field', () => {
    const positions = ['T4', '1', 'CUT', null, 'T38', '2', 'WD', 'T4', '12'];
    const sorted = [...positions].sort(
      (a, b) => parseFinishingPosition(a) - parseFinishingPosition(b),
    );
    expect(sorted).toEqual(['1', '2', 'T4', 'T4', '12', 'T38', 'CUT', 'WD', null]);
  });
});
