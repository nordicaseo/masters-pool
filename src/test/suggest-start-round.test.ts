import { describe, expect, it } from 'vitest';
import { suggestStartRound } from '@/lib/games';

/**
 * Helper to build a small synthetic field of competitors that have
 * `linescores` populated through a given round.
 */
function field(opts: {
  n: number;
  /** Through which round each competitor's linescores has a value. */
  through: number;
  /** How many to mark missed_cut (subtracted from `n`). */
  missedCut?: number;
}) {
  const out: Array<{
    missedCut?: boolean;
    linescores?: Array<{ value?: number; displayValue?: string; period?: number }>;
  }> = [];
  for (let i = 0; i < opts.n; i++) {
    const cut = i < (opts.missedCut ?? 0);
    const linescores = [1, 2, 3, 4].map((period) => ({
      period,
      ...(period <= opts.through
        ? { value: 70, displayValue: '-1' }
        : {}),
    }));
    out.push({ missedCut: cut, linescores });
  }
  return out;
}

describe('suggestStartRound', () => {
  it('returns 1 when the tournament hasn\'t started', () => {
    const competitors = field({ n: 10, through: 0 });
    expect(suggestStartRound({ competitors })).toBe(1);
  });

  it('returns 1 while round 1 is in progress (less than half done)', () => {
    // 10 competitors, only 3 have round-1 linescore populated.
    const competitors = field({ n: 7, through: 0 });
    competitors.push(...field({ n: 3, through: 1 }));
    expect(suggestStartRound({ competitors })).toBe(1);
  });

  it('returns 2 once round 1 is done by the majority', () => {
    const competitors = field({ n: 10, through: 1 });
    expect(suggestStartRound({ competitors })).toBe(2);
  });

  it('returns 3 after round 2 is done (the "create pool after Day 2" case)', () => {
    const competitors = field({ n: 10, through: 2 });
    expect(suggestStartRound({ competitors })).toBe(3);
  });

  it('caps at 4 — never goes past the final round', () => {
    const competitors = field({ n: 10, through: 4 });
    expect(suggestStartRound({ competitors })).toBe(4);
  });

  it('ignores missed-cut competitors when computing the majority', () => {
    // 10 total, 5 cut, only 5 active. 3 of those 5 have round-3 linescores
    // (>= half of the 5 active) — so round 3 is "done" but round 4 isn't.
    const competitors = field({ n: 5, through: 2, missedCut: 0 }).concat(
      field({ n: 5, through: 3 }),
    );
    // Mark first 5 as cut.
    for (let i = 0; i < 5; i++) competitors[i]!.missedCut = true;
    expect(suggestStartRound({ competitors })).toBe(4);
  });

  it('returns 1 for an empty field', () => {
    expect(suggestStartRound({ competitors: [] })).toBe(1);
  });
});
