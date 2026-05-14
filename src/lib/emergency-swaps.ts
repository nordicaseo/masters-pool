/**
 * Emergency pick swap — "I picked the wrong golfer" workflow.
 *
 * Distinct from substitutions:
 *   - Substitutions are *strategic* (Day-1 or Day-2 swap windows, may
 *     incur top-pick cost). One per window per participant.
 *   - Emergency swaps are *corrections* (you meant Matt Fitzpatrick, you
 *     clicked Alex Fitzpatrick). No cost, no sub burned. Available any
 *     time before the tournament finishes, gated by unanimous approval
 *     from every signed-in participant.
 *
 * Apply mechanics: instead of inserting a new pick row, we UPDATE the
 * dropped pick's `golfer_id` to the new golfer. Same `start_round` /
 * `end_round` bounds. Net effect: every event the wrong golfer had
 * earned for this participant disappears from their total, every event
 * the right golfer earned in the same active period appears. As if the
 * misclick never happened. The unanimous-approval gate is what keeps
 * this from being abused — if you're trying to bail out of a losing
 * pick mid-tournament, the rest of the pool will vote no.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  emergencySwapProposals,
  emergencySwapVotes,
  games,
  golfers as golfersTable,
  participants,
  picks,
  type ProposalStatus,
  type ProposalVote,
} from '@/db/schema';
import { logError } from './log';
import { tallyVotes, type VoteTally } from './rule-changes';

/**
 * Eligible voters for a swap proposal = participants in this game with a
 * Clerk user. Same definition as rule changes. Mirrors the helper there
 * but stays local so the two flows can drift independently if needed.
 */
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
  return rows.filter(
    (r): r is { id: number; userId: string; displayName: string } =>
      r.userId !== null,
  );
}

/**
 * Apply an approved swap: change the pick's `golfer_id` to the
 * proposal's `new_golfer_id`. No event rewrites needed — events stay
 * attached to their original golfers and the leaderboard derives totals
 * from `picks` joined to those events.
 */
async function applyApprovedSwap(input: {
  proposalId: number;
  droppedPickId: number;
  newGolferId: number;
}): Promise<void> {
  await db
    .update(picks)
    .set({ golferId: input.newGolferId })
    .where(eq(picks.id, input.droppedPickId));
  await db
    .update(emergencySwapProposals)
    .set({ status: 'approved', resolvedAt: new Date() })
    .where(eq(emergencySwapProposals.id, input.proposalId));
}

/**
 * Create a new emergency-swap proposal. Auto-records the proposer's
 * approve vote. If they're the sole eligible voter, applies the swap
 * immediately.
 */
export async function createSwapProposal(input: {
  gameId: number;
  proposerUserId: string;
  droppedPickId: number;
  newGolferId: number;
}): Promise<{
  proposalId: number;
  status: ProposalStatus;
}> {
  const [game] = await db
    .select()
    .from(games)
    .where(eq(games.id, input.gameId))
    .limit(1);
  if (!game) throw new Error('Game not found');
  if (game.status === 'post') {
    throw new Error("Can't request a swap — the tournament is over");
  }

  // Find the proposer's participant row.
  const voters = await eligibleVoters(input.gameId);
  const proposerParticipant = voters.find(
    (v) => v.userId === input.proposerUserId,
  );
  if (!proposerParticipant) {
    throw new Error("You're not a participant in this pool");
  }

  // Refuse if there's already a pending swap proposal in this game.
  // Keeps voting simple — one ballot at a time.
  const existing = await db
    .select({ id: emergencySwapProposals.id })
    .from(emergencySwapProposals)
    .where(
      and(
        eq(emergencySwapProposals.gameId, input.gameId),
        eq(emergencySwapProposals.status, 'pending'),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    throw new Error(
      'Another emergency-swap proposal is already pending in this pool. Cancel or wait for it to resolve first.',
    );
  }

  // Verify the dropped pick belongs to the proposer and is still active.
  const [dropped] = await db
    .select()
    .from(picks)
    .where(eq(picks.id, input.droppedPickId))
    .limit(1);
  if (!dropped) throw new Error('Pick not found');
  if (dropped.participantId !== proposerParticipant.id) {
    throw new Error("That pick isn't yours");
  }
  if (dropped.endRound !== 99) {
    throw new Error('That pick is no longer active');
  }

  // Verify the new golfer is in this game's field.
  const [newGolfer] = await db
    .select()
    .from(golfersTable)
    .where(
      and(
        eq(golfersTable.id, input.newGolferId),
        eq(golfersTable.gameId, input.gameId),
      ),
    )
    .limit(1);
  if (!newGolfer) throw new Error('Golfer is not in this tournament');

  // Refuse a swap-in-place (same golfer — would be a no-op).
  if (dropped.golferId === input.newGolferId) {
    throw new Error("That's the same golfer you already have");
  }

  // Refuse picking a golfer the proposer ALREADY has on their roster
  // (would violate the picks_participant_golfer_unique index anyway).
  const sameOwner = await db
    .select({ id: picks.id })
    .from(picks)
    .where(
      and(
        eq(picks.participantId, proposerParticipant.id),
        eq(picks.golferId, input.newGolferId),
      ),
    )
    .limit(1);
  if (sameOwner.length > 0) {
    throw new Error(
      "You already have that golfer on your roster — pick someone else",
    );
  }

  // Insert the proposal row + the proposer's auto-approve vote.
  const [proposal] = await db
    .insert(emergencySwapProposals)
    .values({
      gameId: input.gameId,
      proposedByUserId: input.proposerUserId,
      participantId: proposerParticipant.id,
      droppedPickId: input.droppedPickId,
      newGolferId: input.newGolferId,
    })
    .returning();

  try {
    await db.insert(emergencySwapVotes).values({
      proposalId: proposal.id,
      participantId: proposerParticipant.id,
      vote: 'approve',
    });
  } catch (error) {
    logError(error, {
      subsystem: 'emergency_swaps',
      operation: 'auto_approve_vote',
      extra: { proposalId: proposal.id, proposerUserId: input.proposerUserId },
    });
    throw error;
  }

  if (voters.length === 1) {
    await applyApprovedSwap({
      proposalId: proposal.id,
      droppedPickId: input.droppedPickId,
      newGolferId: input.newGolferId,
    });
    return { proposalId: proposal.id, status: 'approved' };
  }
  return { proposalId: proposal.id, status: 'pending' };
}

/** Vote on a pending swap proposal. */
export async function voteOnSwapProposal(input: {
  proposalId: number;
  callerUserId: string;
  vote: ProposalVote;
}): Promise<{ status: ProposalStatus; tally: VoteTally }> {
  const [proposal] = await db
    .select()
    .from(emergencySwapProposals)
    .where(eq(emergencySwapProposals.id, input.proposalId))
    .limit(1);
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'pending') {
    throw new Error(`This swap is already ${proposal.status}`);
  }

  const voters = await eligibleVoters(proposal.gameId);
  const callerVoter = voters.find((v) => v.userId === input.callerUserId);
  if (!callerVoter) {
    throw new Error("You're not a participant in this pool");
  }

  // Refuse re-voting (unique index also enforces this).
  const existing = await db
    .select({ id: emergencySwapVotes.id })
    .from(emergencySwapVotes)
    .where(
      and(
        eq(emergencySwapVotes.proposalId, input.proposalId),
        eq(emergencySwapVotes.participantId, callerVoter.id),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    throw new Error("You've already voted on this swap");
  }

  await db.insert(emergencySwapVotes).values({
    proposalId: input.proposalId,
    participantId: callerVoter.id,
    vote: input.vote,
  });

  // Re-tally.
  const allVotes = await db
    .select({
      participantId: emergencySwapVotes.participantId,
      vote: emergencySwapVotes.vote,
    })
    .from(emergencySwapVotes)
    .where(eq(emergencySwapVotes.proposalId, input.proposalId));
  const tally = tallyVotes({
    eligibleVoterIds: voters.map((v) => v.id),
    votes: allVotes,
  });

  if (tally.anyReject) {
    await db
      .update(emergencySwapProposals)
      .set({ status: 'rejected', resolvedAt: new Date() })
      .where(eq(emergencySwapProposals.id, input.proposalId));
    return { status: 'rejected', tally };
  }
  if (tally.unanimous) {
    await applyApprovedSwap({
      proposalId: input.proposalId,
      droppedPickId: proposal.droppedPickId,
      newGolferId: proposal.newGolferId,
    });
    return { status: 'approved', tally };
  }
  return { status: 'pending', tally };
}

/** Proposer cancels their own pending swap. */
export async function cancelSwapProposal(input: {
  proposalId: number;
  callerUserId: string;
}): Promise<void> {
  const [proposal] = await db
    .select()
    .from(emergencySwapProposals)
    .where(eq(emergencySwapProposals.id, input.proposalId))
    .limit(1);
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'pending') {
    throw new Error(`This swap is already ${proposal.status}`);
  }
  if (proposal.proposedByUserId !== input.callerUserId) {
    throw new Error('Only the proposer can cancel this swap');
  }
  await db
    .update(emergencySwapProposals)
    .set({ status: 'cancelled', resolvedAt: new Date() })
    .where(eq(emergencySwapProposals.id, input.proposalId));
}

/**
 * Pending swap (if any) for the banner. Returns the human-readable
 * before/after golfer names so the UI can render the diff without
 * additional lookups.
 */
export type PendingSwapView = {
  id: number;
  proposedByUserId: string;
  proposedAt: Date;
  participantDisplayName: string;
  droppedGolferName: string;
  newGolferName: string;
  voters: Array<{
    participantId: number;
    displayName: string;
    userId: string;
    vote: ProposalVote | null;
  }>;
  tally: VoteTally;
};

export async function getPendingSwap(
  gameId: number,
): Promise<PendingSwapView | null> {
  const [proposal] = await db
    .select()
    .from(emergencySwapProposals)
    .where(
      and(
        eq(emergencySwapProposals.gameId, gameId),
        eq(emergencySwapProposals.status, 'pending'),
      ),
    )
    .limit(1);
  if (!proposal) return null;

  // Look up the human-readable bits in parallel.
  const [participantRow, droppedPickRow, newGolferRow, voters] = await Promise.all([
    db
      .select({ displayName: participants.displayName })
      .from(participants)
      .where(eq(participants.id, proposal.participantId))
      .limit(1),
    db
      .select({ name: golfersTable.name })
      .from(picks)
      .innerJoin(golfersTable, eq(picks.golferId, golfersTable.id))
      .where(eq(picks.id, proposal.droppedPickId))
      .limit(1),
    db
      .select({ name: golfersTable.name })
      .from(golfersTable)
      .where(eq(golfersTable.id, proposal.newGolferId))
      .limit(1),
    eligibleVoters(gameId),
  ]);

  const allVotes = await db
    .select({
      participantId: emergencySwapVotes.participantId,
      vote: emergencySwapVotes.vote,
    })
    .from(emergencySwapVotes)
    .where(eq(emergencySwapVotes.proposalId, proposal.id));
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
    participantDisplayName: participantRow[0]?.displayName ?? 'Someone',
    droppedGolferName: droppedPickRow[0]?.name ?? '?',
    newGolferName: newGolferRow[0]?.name ?? '?',
    voters: voters.map((v) => ({
      participantId: v.id,
      displayName: v.displayName,
      userId: v.userId,
      vote: voteByParticipant.get(v.id) ?? null,
    })),
    tally,
  };
}

/** Recent resolved swaps, for the audit-history section under House rules. */
export async function getRecentResolvedSwaps(
  gameId: number,
  limit = 5,
): Promise<
  Array<{
    id: number;
    status: ProposalStatus;
    proposedByUserId: string;
    proposedAt: Date;
    resolvedAt: Date | null;
    participantDisplayName: string;
    droppedGolferName: string;
    newGolferName: string;
  }>
> {
  const rows = await db
    .select({
      id: emergencySwapProposals.id,
      status: emergencySwapProposals.status,
      proposedByUserId: emergencySwapProposals.proposedByUserId,
      proposedAt: emergencySwapProposals.proposedAt,
      resolvedAt: emergencySwapProposals.resolvedAt,
      participantDisplayName: participants.displayName,
      droppedGolferId: emergencySwapProposals.droppedPickId,
      newGolferId: emergencySwapProposals.newGolferId,
    })
    .from(emergencySwapProposals)
    .innerJoin(
      participants,
      eq(participants.id, emergencySwapProposals.participantId),
    )
    .where(eq(emergencySwapProposals.gameId, gameId));
  const resolved = rows
    .filter((r) => r.status !== 'pending')
    .sort(
      (a, b) =>
        (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0),
    )
    .slice(0, limit);
  if (resolved.length === 0) return [];

  // Hydrate golfer names — small N, one query per pick + one per golfer.
  const result = await Promise.all(
    resolved.map(async (r) => {
      const [droppedPick, newGolfer] = await Promise.all([
        db
          .select({ name: golfersTable.name })
          .from(picks)
          .innerJoin(golfersTable, eq(picks.golferId, golfersTable.id))
          .where(eq(picks.id, r.droppedGolferId))
          .limit(1),
        db
          .select({ name: golfersTable.name })
          .from(golfersTable)
          .where(eq(golfersTable.id, r.newGolferId))
          .limit(1),
      ]);
      return {
        id: r.id,
        status: r.status,
        proposedByUserId: r.proposedByUserId,
        proposedAt: r.proposedAt,
        resolvedAt: r.resolvedAt,
        participantDisplayName: r.participantDisplayName,
        droppedGolferName: droppedPick[0]?.name ?? '?',
        newGolferName: newGolfer[0]?.name ?? '?',
      };
    }),
  );
  return result;
}
