import { describe, expect, it } from 'vitest';
import { sumLinescoreDisplayValues } from '@/lib/espn';

describe('sumLinescoreDisplayValues', () => {
  it('returns null when linescores is missing or empty', () => {
    expect(sumLinescoreDisplayValues(undefined)).toBeNull();
    expect(sumLinescoreDisplayValues([])).toBeNull();
  });

  it('returns null when no linescore has a displayValue (pre-tournament)', () => {
    expect(
      sumLinescoreDisplayValues([{ displayValue: undefined }, {}]),
    ).toBeNull();
  });

  it('sums a single in-progress round (mid-round)', () => {
    // This is the live Spieth case from the user's bug report:
    // ESPN's aggregate said "E" but the round-1 linescore was correct.
    expect(
      sumLinescoreDisplayValues([
        { displayValue: '-2' },
        { displayValue: undefined }, // round 2 hasn't started
      ]),
    ).toBe(-2);
  });

  it('sums multiple completed rounds', () => {
    expect(
      sumLinescoreDisplayValues([
        { displayValue: '-4' },
        { displayValue: '-1' },
        { displayValue: '+2' },
        { displayValue: '-2' },
      ]),
    ).toBe(-5);
  });

  it('treats E as 0 in the sum', () => {
    expect(
      sumLinescoreDisplayValues([
        { displayValue: '-3' },
        { displayValue: 'E' },
        { displayValue: '+1' },
      ]),
    ).toBe(-2);
  });

  it('skips unparseable entries instead of failing', () => {
    expect(
      sumLinescoreDisplayValues([
        { displayValue: '-2' },
        { displayValue: '--' },
        { displayValue: '' },
      ]),
    ).toBe(-2);
  });
});
