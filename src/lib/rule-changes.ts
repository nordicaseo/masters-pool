/**
 * Creator-proposed rule changes with unanimous-approval gating.
 *
 * Flow:
 *   1. Creator opens a proposal with the new rules.
 *   2. Every participant in the pool with a non-null `user_id` is an
 *      eligible voter. The proposer's vote is auto-approve on creation.
 *   3. Other voters approve or reject. ANY reject vote kills the proposal.
 *      All approves applies it.
 *   4. On apply: `games.scoring_rules` is updated AND every per-hole
 *      `scoring_events.points` row in the game is recomputed from the new
 *      rules. This keeps the leaderboard consistent regardless of when in
 *      the tournament the fix lands — if you were "leading" because a bug
 *      gave triples +4 instead of -5, your lead disappears as soon as the
 *      change applies.
 *
 * Constraints:
 *   - Only the game creator can propose (v1).
 *   - At most one `pending` proposal per game at a time.
 *   - Cannot propose after `games.status = 'post'` (game is final).
 *   - `picks_per_user` is locked in via `validateProposedRules` — changing
 *     it after picks have been made would break the model.
 *   - `top_pick_costs` changes only affect FUTURE substitutions; past
 *     substitution costs were computed against the live leaderboard at
 *     swap time and aren't recomputable here.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  games,
  participants,
  ruleChangeProposals,
  ruleChangeVotes,
  scoringEvents,
  type ProposalStatus,
  type ProposalVote,
  type ScoringEventKind,
  type ScoringRules,
} from '@/db/schema';
import { logError } from './log';
import { pointsForKind } from './scoring';

/** Per-hole scoring kinds whose `points` column gets recomputed on apply. */
const PER_HOLE_KINDS: ScoringEventKind[] = [
  'birdie',
  'eagle',
  'albatross',
  'hole_in_one',
  'bogey',
  'double_bogey',
  'triple_plus',
];

/**
 * Throw if the proposed rules try to change a locked field. Used by both
 * the API route and the server library so the client can't bypass it.
 */
export function validateProposedRules(
  before: ScoringRules,
  after: ScoringRules,
): void {
  if (before.picks_per_user !== after.picks_per_user) {
    throw new Error(
      "Can't change picks-per-user after the pool exists — that would invalidate everyone's roster",
    );
  }
}

/** Eligible voters for a game = participants whose `user_id` is set. */
async function eligibleVoters(
  gameId: number,
): Promise<Array<{ id: number; userId: string; displayName: string }>> {
  const rows = await db
    .select({
      id: participants.id,
      userId: participants.userId,
      displayName: participants.displayName,
    })
    .from(participants)
    .where(eq(participants.gameId, gameId));
  return rows
    .filter((r): r is { id: number; userId: string; displayName: string } =>
      r.userId !== null,
    );
}

/**
 * Tally an in-progress proposal: counts approves, returns whether any
 * reject vote exists, and whether the proposal is fully approved (all
 * eligible voters have voted approve).
 */
export type VoteTally = {
  approveCount: number;
  rejectCount: number;
  eligibleCount: number;
  /** True when at least one reject vote was cast. */
  anyReject: boolean;
  /** True when every eligible voter has voted approve. */
  unanimous: boolean;
};

export function tallyVotes(input: {
  eligibleVoterIds: number[];
  votes: Array<{ participantId: number; vote: ProposalVote }>;
}): VoteTally {
  const eligibleSet = new Set(input.eligibleVoterIds);
  // Only count votes from currently-eligible voters (defensive: votes from
  // participants who later left the pool are ignored).
  const relevant = input.votes.filter((v) => eligibleSet.has(v.participantId));
  const approveCount = relevant.filter((v) => v.vote === 'approve').length;
  const rejectCount = relevant.filter((v) => v.vote === 'reject').length;
  return {
    approveCount,
    rejectCount,
    eligibleCount: input.eligibleVoterIds.length,
    anyReject: rejectCount > 0,
    unanimous:
      input.eligibleVoterIds.length > 0 &&
      approveCount === input.eligibleVoterIds.length,
  };
}

/**
 * Recompute every per-hole `scoring_events.points` row in the game using
 * the given rules. Called inside `applyApprovedProposal` after the game's
 * stored rules have been swapped. Finish bonuses and `missed_cut` markers
 * are NOT touched — finish bonuses depend on live finish positions at
 * the moment of insert (and tie handling), which we can't reconstruct
 * here. We block applies after `games.status = 'post'` upstream so this
 * is safe.
 */
async function recomputePerHolePoints(
  gameId: number,
  rules: ScoringRules,
): Promise<number> {
  let updated = 0;
  for (const kind of PER_HOLE_KINDS) {
    const newPoints = pointsForKind(rules, kind);
    const result = await db
      .update(scoringEvents)
      .set({ points: newPoints })
      .where(
        and(eq(scoringEvents.gameId, gameId), eq(scoringEvents.kind, kind)),
      )
      .returning({ id: scoringEvents.id });
    updated += result.length;
  }
  return updated;
}

/**
 * Apply an approved proposal: swap the game's scoring rules and recompute
 * per-hole points. Marks the proposal `approved` with a resolution time.
 */
async function applyApprovedProposal(input: {
  proposalId: number;
  gameId: number;
  afterRules: ScoringRules;
}): Promise<{ pointsRecomputed: number }> {
  await db
    .update(games)
    .set({ scoringRules: input.afterRules })
    .where(eq(games.id, input.gameId));

  const pointsRecomputed = await recomputePerHolePoints(
    input.gameId,
    input.afterRules,
  );

  await db
    .update(ruleChangeProposals)
    .set({ status: 'approved', resolvedAt: new Date() })
    .where(eq(ruleChangeProposals.id, input.proposalId));

  return { pointsRecomputed };
}

/**
 * Open a new proposal. Auto-records an `approve` vote from the proposer.
 * If the proposer is the only eligible voter (e.g. a manual-roster pool
 * with no other Clerk users), the proposal is immediately applied.
 */
export async function createProposal(input: {
  gameId: number;
  proposerUserId: string;
  afterRules: ScoringRules;
}): Promise<{
  proposalId: number;
  status: ProposalStatus;
  pointsRecomputed: number;
}> {
  const [game] = await db
    .select()
    .from(games)
    .where(eq(games.id, input.gameId))
    .limit(1);
  if (!game) throw new Error('Game not found');
  if (game.status === 'post') {
    throw new Error("Can't change rules — the tournament is over");
  }
  if (game.createdByUserId !== input.proposerUserId) {
    throw new Error('Only the pool creator can propose rule changes');
  }

  // Refuse if there's already a pending proposal.
  const existingPending = await db
    .select({ id: ruleChangeProposals.id })
    .from(ruleChangeProposals)
    .where(
      and(
        eq(ruleChangeProposals.gameId, input.gameId),
        eq(ruleChangeProposals.status, 'pending'),
      ),
    )
    .limit(1);
  if (existingPending.length > 0) {
    throw new Error(
      'Another rule-change proposal is already open. Cancel or wait for it to resolve first.',
    );
  }

  // Find the proposer's participant row (so we can attribute their auto-approve vote).
  const voters = await eligibleVoters(input.gameId);
  const proposerParticipant = voters.find(
    (v) => v.userId === input.proposerUserId,
  );
  if (!proposerParticipant) {
    throw new Error("You're not a participant in this pool");
  }

  validateProposedRules(game.scoringRules, input.afterRules);

  // Insert the proposal row.
  const [proposal] = await db
    .insert(ruleChangeProposals)
    .values({
      gameId: input.gameId,
      proposedByUserId: input.proposerUserId,
      beforeRules: game.scoringRules,
      afterRules: input.afterRules,
    })
    .returning();

  // Auto-approve from the proposer.
  try {
    await db.insert(ruleChangeVotes).values({
      proposalId: proposal.id,
      participantId: proposerParticipant.id,
      vote: 'approve',
    });
  } catch (error) {
    logError(error, {
      subsystem: 'rule_changes',
      operation: 'auto_approve_vote',
      extra: { proposalId: proposal.id, proposerUserId: input.proposerUserId },
    });
    throw error;
  }

  // If the proposer is the sole eligible voter, apply immediately.
  if (voters.length === 1) {
    const { pointsRecomputed } = await applyApprovedProposal({
      proposalId: proposal.id,
      gameId: input.gameId,
      afterRules: input.afterRules,
    });
    return { proposalId: proposal.id, status: 'approved', pointsRecomputed };
  }

  return { proposalId: proposal.id, status: 'pending', pointsRecomputed: 0 };
}

/**
 * Record a vote from a participant. Re-evaluates the proposal's status
 * after recording. Returns the resulting status.
 */
export async function voteOnProposal(input: {
  proposalId: number;
  callerUserId: string;
  vote: ProposalVote;
}): Promise<{
  status: ProposalStatus;
  tally: VoteTally;
  pointsRecomputed: number;
}> {
  const [proposal] = await db
    .select()
    .from(ruleChangeProposals)
    .where(eq(ruleChangeProposals.id, input.proposalId))
    .limit(1);
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'pending') {
    throw new Error(`This proposal is already ${proposal.status}`);
  }

  // Caller must be an eligible voter in this game.
  const voters = await eligibleVoters(proposal.gameId);
  const callerVoter = voters.find((v) => v.userId === input.callerUserId);
  if (!callerVoter) {
    throw new Error("You're not a participant in this pool");
  }

  // Refuse re-voting; uniqueness index would also catch this at the DB.
  const existing = await db
    .select({ id: ruleChangeVotes.id })
    .from(ruleChangeVotes)
    .where(
      and(
        eq(ruleChangeVotes.proposalId, input.proposalId),
        eq(ruleChangeVotes.participantId, callerVoter.id),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    throw new Error("You've already voted on this proposal");
  }

  await db.insert(ruleChangeVotes).values({
    proposalId: input.proposalId,
    participantId: callerVoter.id,
    vote: input.vote,
  });

  // Re-tally.
  const allVotes = await db
    .select({
      participantId: ruleChangeVotes.participantId,
      vote: ruleChangeVotes.vote,
    })
    .from(ruleChangeVotes)
    .where(eq(ruleChangeVotes.proposalId, input.proposalId));
  const tally = tallyVotes({
    eligibleVoterIds: voters.map((v) => v.id),
    votes: allVotes,
  });

  // Resolve if we can.
  if (tally.anyReject) {
    await db
      .update(ruleChangeProposals)
      .set({ status: 'rejected', resolvedAt: new Date() })
      .where(eq(ruleChangeProposals.id, input.proposalId));
    return { status: 'rejected', tally, pointsRecomputed: 0 };
  }
  if (tally.unanimous) {
    const { pointsRecomputed } = await applyApprovedProposal({
      proposalId: input.proposalId,
      gameId: proposal.gameId,
      afterRules: proposal.afterRules,
    });
    return { status: 'approved', tally, pointsRecomputed };
  }
  return { status: 'pending', tally, pointsRecomputed: 0 };
}

/** Creator cancels their own pending proposal. */
export async function cancelProposal(input: {
  proposalId: number;
  callerUserId: string;
}): Promise<void> {
  const [proposal] = await db
    .select()
    .from(ruleChangeProposals)
    .where(eq(ruleChangeProposals.id, input.proposalId))
    .limit(1);
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'pending') {
    throw new Error(`This proposal is already ${proposal.status}`);
  }
  if (proposal.proposedByUserId !== input.callerUserId) {
    throw new Error('Only the proposer can cancel this proposal');
  }
  await db
    .update(ruleChangeProposals)
    .set({ status: 'cancelled', resolvedAt: new Date() })
    .where(eq(ruleChangeProposals.id, input.proposalId));
}

/**
 * Read the open proposal (if any) for a game, with everything the UI
 * needs: the diff, who's voted, who hasn't, whether the caller can vote.
 */
export type PendingProposalView = {
  id: number;
  proposedByUserId: string;
  proposedAt: Date;
  beforeRules: ScoringRules;
  afterRules: ScoringRules;
  voters: Array<{
    participantId: number;
    displayName: string;
    userId: string;
    vote: ProposalVote | null;
  }>;
  tally: VoteTally;
};

export async function getPendingProposal(
  gameId: number,
): Promise<PendingProposalView | null> {
  const [proposal] = await db
    .select()
    .from(ruleChangeProposals)
    .where(
      and(
        eq(ruleChangeProposals.gameId, gameId),
        eq(ruleChangeProposals.status, 'pending'),
      ),
    )
    .limit(1);
  if (!proposal) return null;

  const voters = await eligibleVoters(gameId);
  const allVotes = await db
    .select({
      participantId: ruleChangeVotes.participantId,
      vote: ruleChangeVotes.vote,
    })
    .from(ruleChangeVotes)
    .where(eq(ruleChangeVotes.proposalId, proposal.id));
  const voteByParticipant = new Map(
    allVotes.map((v) => [v.participantId, v.vote]),
  );
  const tally = tallyVotes({
    eligibleVoterIds: voters.map((v) => v.id),
    votes: allVotes,
  });

  return {
    id: proposal.id,
    proposedByUserId: proposal.proposedByUserId,
    proposedAt: proposal.proposedAt,
    beforeRules: proposal.beforeRules,
    afterRules: proposal.afterRules,
    voters: voters.map((v) => ({
      participantId: v.id,
      displayName: v.displayName,
      userId: v.userId,
      vote: voteByParticipant.get(v.id) ?? null,
    })),
    tally,
  };
}

/**
 * Resolved proposals for the audit history. Limited to a small number of
 * recent ones to keep the page light.
 */
export async function getRecentResolvedProposals(
  gameId: number,
  limit = 5,
): Promise<
  Array<{
    id: number;
    status: ProposalStatus;
    proposedByUserId: string;
    proposedAt: Date;
    resolvedAt: Date | null;
    beforeRules: ScoringRules;
    afterRules: ScoringRules;
  }>
> {
  const rows = await db
    .select({
      id: ruleChangeProposals.id,
      status: ruleChangeProposals.status,
      proposedByUserId: ruleChangeProposals.proposedByUserId,
      proposedAt: ruleChangeProposals.proposedAt,
      resolvedAt: ruleChangeProposals.resolvedAt,
      beforeRules: ruleChangeProposals.beforeRules,
      afterRules: ruleChangeProposals.afterRules,
    })
    .from(ruleChangeProposals)
    .where(eq(ruleChangeProposals.gameId, gameId));
  return rows
    .filter((r) => r.status !== 'pending')
    .sort(
      (a, b) =>
        (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0),
    )
    .slice(0, limit);
}

/**
 * Compute the diff between two scoring-rules objects for display in the
 * approval UI. Only fields whose value changed are returned. Pure.
 */
export type RuleDiffEntry = {
  key: string;
  /** Human-readable label like "Triple+" or "Top-pick #2 cost". */
  label: string;
  before: number | string;
  after: number | string;
};

const RULE_LABELS: Record<string, string> = {
  hole_in_one: 'Hole-in-one',
  albatross: 'Albatross',
  eagle: 'Eagle',
  birdie: 'Birdie',
  par: 'Par',
  bogey: 'Bogey',
  double_bogey: 'Double bogey',
  triple_plus: 'Triple+',
  finish_1: '1st place',
  finish_2: '2nd place',
  finish_3: '3rd place',
  tie_handling: 'Tie handling',
};

export function diffScoringRules(
  before: ScoringRules,
  after: ScoringRules,
): RuleDiffEntry[] {
  const entries: RuleDiffEntry[] = [];
  for (const [k, label] of Object.entries(RULE_LABELS)) {
    const bv = (before as unknown as Record<string, number | string>)[k];
    const av = (after as unknown as Record<string, number | string>)[k];
    if (bv !== av) {
      entries.push({ key: k, label, before: bv, after: av });
    }
  }
  const beforeCosts = before.top_pick_costs ?? [-3, -2, -1, 0, 0];
  const afterCosts = after.top_pick_costs ?? [-3, -2, -1, 0, 0];
  for (let i = 0; i < 5; i++) {
    if (beforeCosts[i] !== afterCosts[i]) {
      entries.push({
        key: `top_pick_costs[${i}]`,
        label: `Top-pick #${i + 1} cost`,
        before: beforeCosts[i] ?? 0,
        after: afterCosts[i] ?? 0,
      });
    }
  }
  return entries;
}
