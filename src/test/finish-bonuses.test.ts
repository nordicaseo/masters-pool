import { describe, expect, it } from 'vitest';
import { computeFinishBonuses } from '@/lib/scoring';
import type { FieldRow } from '@/lib/espn';
import { DEFAULT_SCORING_RULES, type ScoringRules } from '@/db/schema';

function row(id: string, position: string, missedCut = false): FieldRow {
  return {
    espnAthleteId: id,
    name: `Golfer ${id}`,
    country: null,
    position,
    scoreToPar: null,
    missedCut,
  };
}

const splitFloor: ScoringRules = { ...DEFAULT_SCORING_RULES, tie_handling: 'split_floor' };
const full: ScoringRules = { ...DEFAULT_SCORING_RULES, tie_handling: 'full' };

describe('computeFinishBonuses — split_floor', () => {
  it('awards each podium place individually when there are no ties', () => {
    const awards = computeFinishBonuses(
      [row('a', '1'), row('b', '2'), row('c', '3'), row('d', '4')],
      splitFloor,
    );
    expect(awards).toEqual([
      { kind: 'finish_1', espnAthleteId: 'a', points: 20 },
      { kind: 'finish_2', espnAthleteId: 'b', points: 10 },
      { kind: 'finish_3', espnAthleteId: 'c', points: 5 },
    ]);
  });

  it('splits the finish_1 + finish_2 pool on a 2-way tie for 1st; solo 3rd still pays finish_3', () => {
    const awards = computeFinishBonuses(
      [row('a', 'T1'), row('b', 'T1'), row('c', '3')],
      splitFloor,
    );
    expect(awards).toEqual([
      { kind: 'finish_1', espnAthleteId: 'a', points: 15 },
      { kind: 'finish_1', espnAthleteId: 'b', points: 15 },
      { kind: 'finish_3', espnAthleteId: 'c', points: 5 },
    ]);
  });

  it('floor-divides the full podium pool on a 4-way tie for 1st', () => {
    // (20 + 10 + 5) / 4 = 8.75 -> floor 8
    const awards = computeFinishBonuses(
      [row('a', 'T1'), row('b', 'T1'), row('c', 'T1'), row('d', 'T1')],
      splitFloor,
    );
    expect(awards).toHaveLength(4);
    for (const award of awards) {
      expect(award.kind).toBe('finish_1');
      expect(award.points).toBe(8);
    }
  });

  it('handles a tie spanning the podium cutoff (1st alone, 3-way tie for 2nd)', () => {
    const awards = computeFinishBonuses(
      [row('a', '1'), row('b', 'T2'), row('c', 'T2'), row('d', 'T2')],
      splitFloor,
    );
    // finish_2 + finish_3 = 15, /3 = 5 each.
    expect(awards).toEqual([
      { kind: 'finish_1', espnAthleteId: 'a', points: 20 },
      { kind: 'finish_2', espnAthleteId: 'b', points: 5 },
      { kind: 'finish_2', espnAthleteId: 'c', points: 5 },
      { kind: 'finish_2', espnAthleteId: 'd', points: 5 },
    ]);
  });
});

describe('computeFinishBonuses — full', () => {
  it('pays each tied golfer the highest contested place value on a 4-way tie for 1st', () => {
    // Regression: previous behavior paid each golfer 20+10+5 = 35.
    const awards = computeFinishBonuses(
      [row('a', 'T1'), row('b', 'T1'), row('c', 'T1'), row('d', 'T1')],
      full,
    );
    expect(awards).toHaveLength(4);
    for (const award of awards) {
      expect(award.kind).toBe('finish_1');
      expect(award.points).toBe(20);
    }
  });

  it('pays finish_1 to a 2-way tie and finish_3 to the next solo position', () => {
    const awards = computeFinishBonuses(
      [row('a', 'T1'), row('b', 'T1'), row('c', '3')],
      full,
    );
    expect(awards).toEqual([
      { kind: 'finish_1', espnAthleteId: 'a', points: 20 },
      { kind: 'finish_1', espnAthleteId: 'b', points: 20 },
      { kind: 'finish_3', espnAthleteId: 'c', points: 5 },
    ]);
  });

  it('matches split_floor when there are no ties', () => {
    const fixture = [row('a', '1'), row('b', '2'), row('c', '3')];
    expect(computeFinishBonuses(fixture, full)).toEqual(
      computeFinishBonuses(fixture, splitFloor),
    );
  });
});

describe('computeFinishBonuses — eligibility', () => {
  it('excludes cut golfers and promotes the next finishers up', () => {
    const awards = computeFinishBonuses(
      [row('a', '1', true), row('b', '2'), row('c', '3'), row('d', '4')],
      splitFloor,
    );
    // a is cut, so b/c/d slide up into the podium.
    expect(awards).toEqual([
      { kind: 'finish_1', espnAthleteId: 'b', points: 20 },
      { kind: 'finish_2', espnAthleteId: 'c', points: 10 },
      { kind: 'finish_3', espnAthleteId: 'd', points: 5 },
    ]);
  });

  it('excludes non-numeric positions (CUT, W/D, "-")', () => {
    const awards = computeFinishBonuses(
      [row('a', 'CUT'), row('b', '-'), row('c', '1'), row('d', '2')],
      splitFloor,
    );
    expect(awards.map((a) => a.espnAthleteId)).toEqual(['c', 'd']);
  });

  it('returns no awards when the podium is empty', () => {
    expect(computeFinishBonuses([], splitFloor)).toEqual([]);
    expect(
      computeFinishBonuses([row('a', '1', true), row('b', '2', true)], splitFloor),
    ).toEqual([]);
  });

  it('caps at 3 podium positions regardless of field size', () => {
    const awards = computeFinishBonuses(
      [row('a', '1'), row('b', '2'), row('c', '3'), row('d', '4'), row('e', '5')],
      splitFloor,
    );
    expect(awards).toHaveLength(3);
    expect(awards.map((a) => a.espnAthleteId)).toEqual(['a', 'b', 'c']);
  });
});
