import { describe, expect, it } from 'vitest';
import {
  costForPosition,
  detectSwapWindow,
  endRoundForWindow,
} from '@/lib/substitutions';
import { eventCountsForPick } from '@/lib/scoring';

describe('detectSwapWindow', () => {
  it('returns null before any round is done', () => {
    expect(detectSwapWindow({ roundsStarted: [1], roundsWithHole18: [] })).toBeNull();
  });

  it('opens day_1 once round 1 has a hole-18 event and round 2 has not started', () => {
    expect(
      detectSwapWindow({ roundsStarted: [1], roundsWithHole18: [1] }),
    ).toBe('day_1');
  });

  it('closes day_1 once round 2 starts', () => {
    expect(
      detectSwapWindow({ roundsStarted: [1, 2], roundsWithHole18: [1] }),
    ).toBeNull();
  });

  it('opens day_2 after round 2 finishes and before round 3 starts', () => {
    expect(
      detectSwapWindow({
        roundsStarted: [1, 2],
        roundsWithHole18: [1, 2],
      }),
    ).toBe('day_2');
  });

  it('closes day_2 once round 3 starts', () => {
    expect(
      detectSwapWindow({
        roundsStarted: [1, 2, 3],
        roundsWithHole18: [1, 2],
      }),
    ).toBeNull();
  });

  it('returns day_2 when both day_1 and day_2 predicates would be true', () => {
    // (Edge case — shouldn't normally happen, but we prefer the later window.)
    expect(
      detectSwapWindow({
        roundsStarted: [1],
        roundsWithHole18: [1, 2],
      }),
    ).toBe('day_2');
  });
});

describe('endRoundForWindow', () => {
  it('day_1 swaps end after round 1', () => {
    expect(endRoundForWindow('day_1')).toBe(1);
  });
  it('day_2 swaps end after round 2', () => {
    expect(endRoundForWindow('day_2')).toBe(2);
  });
});

describe('costForPosition', () => {
  const costs = [-5, -4, -3, -2, -1];

  it('returns 0 for null position', () => {
    expect(costForPosition(null, costs)).toBe(0);
  });

  it('returns the configured cost for top-5 numeric positions', () => {
    expect(costForPosition('1', costs)).toBe(-5);
    expect(costForPosition('2', costs)).toBe(-4);
    expect(costForPosition('5', costs)).toBe(-1);
  });

  it('returns 0 outside the top 5', () => {
    expect(costForPosition('6', costs)).toBe(0);
    expect(costForPosition('15', costs)).toBe(0);
  });

  it('strips the T prefix on ties', () => {
    expect(costForPosition('T2', costs)).toBe(-4);
    expect(costForPosition('T5', costs)).toBe(-1);
    expect(costForPosition('T6', costs)).toBe(0);
  });

  it('returns 0 for unparseable positions', () => {
    expect(costForPosition('CUT', costs)).toBe(0);
    expect(costForPosition('WD', costs)).toBe(0);
    expect(costForPosition('', costs)).toBe(0);
  });

  it('returns 0 when the costs array is missing the slot', () => {
    expect(costForPosition('1', [])).toBe(0);
    expect(costForPosition('3', [-3])).toBe(0);
  });
});

describe('eventCountsForPick', () => {
  it('counts a per-hole event when round is inside the pick window', () => {
    expect(
      eventCountsForPick({ round: 2 }, { startRound: 1, endRound: 99 }),
    ).toBe(true);
    expect(
      eventCountsForPick({ round: 3 }, { startRound: 3, endRound: 99 }),
    ).toBe(true);
  });

  it('rejects events before startRound', () => {
    expect(
      eventCountsForPick({ round: 1 }, { startRound: 3, endRound: 99 }),
    ).toBe(false);
  });

  it('rejects events after endRound (dropped pick)', () => {
    expect(
      eventCountsForPick({ round: 2 }, { startRound: 1, endRound: 1 }),
    ).toBe(false);
    expect(
      eventCountsForPick({ round: 3 }, { startRound: 1, endRound: 2 }),
    ).toBe(false);
  });

  it('counts round 0 events only when the pick is still active at the end', () => {
    // Finish bonuses & missed_cut have round=0.
    expect(
      eventCountsForPick({ round: 0 }, { startRound: 1, endRound: 99 }),
    ).toBe(true);
    expect(
      eventCountsForPick({ round: 0 }, { startRound: 1, endRound: 1 }),
    ).toBe(false);
  });
});
