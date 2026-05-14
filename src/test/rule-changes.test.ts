import { describe, expect, it } from 'vitest';
import {
  diffScoringRules,
  tallyVotes,
  validateProposedRules,
} from '@/lib/rule-changes';
import { DEFAULT_SCORING_RULES, type ScoringRules } from '@/db/schema';

const baseRules: ScoringRules = { ...DEFAULT_SCORING_RULES };

describe('tallyVotes', () => {
  it('reports pending when not everyone has voted', () => {
    const t = tallyVotes({
      eligibleVoterIds: [1, 2, 3],
      votes: [{ participantId: 1, vote: 'approve' }],
    });
    expect(t.approveCount).toBe(1);
    expect(t.rejectCount).toBe(0);
    expect(t.eligibleCount).toBe(3);
    expect(t.anyReject).toBe(false);
    expect(t.unanimous).toBe(false);
  });

  it('marks unanimous when every eligible voter approves', () => {
    const t = tallyVotes({
      eligibleVoterIds: [1, 2, 3],
      votes: [
        { participantId: 1, vote: 'approve' },
        { participantId: 2, vote: 'approve' },
        { participantId: 3, vote: 'approve' },
      ],
    });
    expect(t.unanimous).toBe(true);
    expect(t.anyReject).toBe(false);
  });

  it('marks anyReject as soon as a single reject vote comes in', () => {
    const t = tallyVotes({
      eligibleVoterIds: [1, 2, 3],
      votes: [
        { participantId: 1, vote: 'approve' },
        { participantId: 2, vote: 'reject' },
      ],
    });
    expect(t.anyReject).toBe(true);
    expect(t.unanimous).toBe(false);
  });

  it('ignores votes from participants no longer eligible', () => {
    const t = tallyVotes({
      eligibleVoterIds: [1, 2],
      votes: [
        { participantId: 1, vote: 'approve' },
        { participantId: 99, vote: 'reject' }, // stale, ignored
      ],
    });
    expect(t.approveCount).toBe(1);
    expect(t.rejectCount).toBe(0);
    expect(t.anyReject).toBe(false);
  });

  it('handles a single eligible voter (auto-approve case)', () => {
    const t = tallyVotes({
      eligibleVoterIds: [1],
      votes: [{ participantId: 1, vote: 'approve' }],
    });
    expect(t.unanimous).toBe(true);
  });

  it('handles zero eligible voters (degenerate)', () => {
    const t = tallyVotes({ eligibleVoterIds: [], votes: [] });
    expect(t.unanimous).toBe(false); // can't unanimously approve nothing
  });
});

describe('validateProposedRules', () => {
  it('allows changing point values', () => {
    expect(() =>
      validateProposedRules(baseRules, { ...baseRules, triple_plus: -5 }),
    ).not.toThrow();
  });

  it('refuses changing picks_per_user', () => {
    expect(() =>
      validateProposedRules(baseRules, { ...baseRules, picks_per_user: 4 }),
    ).toThrow(/picks-per-user/i);
  });
});

describe('diffScoringRules', () => {
  it('returns an empty array when nothing changed', () => {
    expect(diffScoringRules(baseRules, baseRules)).toEqual([]);
  });

  it('returns the exact field that changed — the Triple+ case from the user report', () => {
    const before = { ...baseRules, triple_plus: 4 }; // the bug
    const after = { ...baseRules, triple_plus: -5 }; // the fix
    const d = diffScoringRules(before, after);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      key: 'triple_plus',
      label: 'Triple+',
      before: 4,
      after: -5,
    });
  });

  it('diffs top_pick_costs entries independently', () => {
    const before = {
      ...baseRules,
      top_pick_costs: [-3, -2, -1, 0, 0],
    };
    const after = {
      ...baseRules,
      top_pick_costs: [-5, -2, -1, 0, 0],
    };
    const d = diffScoringRules(before, after);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      key: 'top_pick_costs[0]',
      label: 'Top-pick #1 cost',
      before: -3,
      after: -5,
    });
  });

  it('collapses multiple changes into one diff array', () => {
    const before = { ...baseRules, triple_plus: 4, bogey: 2 };
    const after = { ...baseRules, triple_plus: -5, bogey: -1 };
    const d = diffScoringRules(before, after);
    expect(d.map((e) => e.key).sort()).toEqual(['bogey', 'triple_plus']);
  });
});
