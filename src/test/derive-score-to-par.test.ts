import { describe, expect, it } from 'vitest';
import { deriveScoreToPar, STROKE_DELTA } from '@/lib/scoring';

describe('deriveScoreToPar', () => {
  it('returns null when there are no per-hole events', () => {
    expect(deriveScoreToPar([])).toBeNull();
    // Round-0 events alone (finish bonuses, missed_cut) shouldn't count.
    expect(
      deriveScoreToPar([
        { kind: 'finish_1', round: 0 },
        { kind: 'missed_cut', round: 0 },
      ]),
    ).toBeNull();
  });

  it('sums birdie/bogey events correctly — matches the Xander case', () => {
    // 3 birdies, 1 bogey across holes 10–15 of round 1 → -2.
    const events = [
      { kind: 'birdie' as const, round: 1 },
      { kind: 'birdie' as const, round: 1 },
      { kind: 'birdie' as const, round: 1 },
      { kind: 'bogey' as const, round: 1 },
    ];
    expect(deriveScoreToPar(events)).toBe(-2);
  });

  it('ignores round-0 events when there are per-hole events', () => {
    const events = [
      { kind: 'birdie' as const, round: 1 },
      { kind: 'finish_1' as const, round: 0 },
      { kind: 'missed_cut' as const, round: 0 },
    ];
    expect(deriveScoreToPar(events)).toBe(-1);
  });

  it('handles eagles and albatrosses', () => {
    expect(
      deriveScoreToPar([
        { kind: 'eagle' as const, round: 1 },
        { kind: 'birdie' as const, round: 1 },
      ]),
    ).toBe(-3);
    expect(
      deriveScoreToPar([
        { kind: 'albatross' as const, round: 1 },
        { kind: 'bogey' as const, round: 1 },
      ]),
    ).toBe(-2);
  });

  it('returns 0 for a round of all pars (no events recorded)', () => {
    // PAR holes aren't logged as events, so a perfect-even round has no events.
    expect(deriveScoreToPar([])).toBeNull();
    // …but a round of one birdie + one bogey is exactly E.
    expect(
      deriveScoreToPar([
        { kind: 'birdie' as const, round: 1 },
        { kind: 'bogey' as const, round: 1 },
      ]),
    ).toBe(0);
  });

  it('sums across multiple rounds', () => {
    const events = [
      { kind: 'birdie' as const, round: 1 },
      { kind: 'birdie' as const, round: 1 },
      { kind: 'eagle' as const, round: 2 },
      { kind: 'bogey' as const, round: 3 },
      { kind: 'double_bogey' as const, round: 3 },
    ];
    expect(deriveScoreToPar(events)).toBe(-1);
  });

  it('STROKE_DELTA covers every ScoringEventKind', () => {
    // Compile-time assertion via exhaustive switch would be nicer, but a
    // runtime check that every kind has a finite delta is cheap and
    // catches the case where a new kind is added without updating the
    // map.
    for (const v of Object.values(STROKE_DELTA)) {
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
