/**
 * Day-1 and Day-2 substitution mechanics.
 *
 * Each participant can use at most ONE substitution per "window":
 *   - day_1: opens after some golfer finishes hole 18 of round 1, closes
 *            once any round-2 event is recorded.
 *   - day_2: opens after some golfer finishes hole 18 of round 2, closes
 *            once any round-3 event is recorded.
 *
 * The swap is one-for-one: drop any pick from your current roster, pick
 * any golfer that is not currently held by any participant. Dropped
 * golfers go back into the available pool immediately.
 *
 * Scoring semantics:
 *   - The dropped pick keeps the events it earned through round R (R = 1
 *     for day_1, 2 for day_2). Its `endRound` is set to R.
 *   - The new pick is inserted with `startRound = R + 1` and `endRound =
 *     99`. Round-0 events (finish bonuses, missed_cut) only count for
 *     picks that finish the tournament still on the roster (endRound =
 *     99); see `participantTotals` in lib/scoring.ts.
 *
 * Top-pick cost:
 *   - Looked up at swap time from the new golfer's current `position`
 *     (e.g. "1", "T2"). If they're currently 1st through 5th, the
 *     configured `top_pick_costs[i]` is recorded as the cost and
 *     subtracted from the participant's total. Original picks are never
 *     charged this cost — only substitutions.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  games,
  golfers as golfersTable,
  participants,
  picks,
  scoringEvents,
  substitutions,
  topPickCosts,
  type ScoringRules,
  type SubstitutionWindow,
} from '@/db/schema';
import { logError } from './log';

export type SwapWindow = SubstitutionWindow | null;

/**
 * Pure function — given which rounds have any event recorded and which
 * have at least one hole-18 event, return the currently open swap
 * window (or null if no window is open).
 *
 * Day-1 window is open once round 1 has had a hole-18 event (someone
 * finished the round) AND round 2 has NOT started.
 * Day-2 window is open once round 2 has had a hole-18 event AND round 3
 * has NOT started.
 *
 * If both predicates would be true (shouldn't happen in practice — round
 * 2 starting implies day-1 closed), day_2 wins.
 */
export function detectSwapWindow(input: {
  roundsStarted: ReadonlySet<number> | readonly number[];
  roundsWithHole18: ReadonlySet<number> | readonly number[];
}): SwapWindow {
  const started = input.roundsStarted instanceof Set ? input.roundsStarted : new Set(input.roundsStarted);
  const hole18 = input.roundsWithHole18 instanceof Set ? input.roundsWithHole18 : new Set(input.roundsWithHole18);

  const round1Done = hole18.has(1);
  const round2Started = started.has(2);
  const round2Done = hole18.has(2);
  const round3Started = started.has(3);

  if (round2Done && !round3Started) return 'day_2';
  if (round1Done && !round2Started) return 'day_1';
  return null;
}

/** Which round number the dropped pick's `endRound` should be set to for a given window. */
export function endRoundForWindow(window: SubstitutionWindow): number {
  return window === 'day_1' ? 1 : 2;
}

/**
 * Read every scoring event for a game and compute the current swap
 * window (if any). Bounded by a small query — events for one tournament
 * are at most a few thousand rows.
 */
export async function currentSwapWindow(gameId: number): Promise<SwapWindow> {
  const rows = await db
    .select({ round: scoringEvents.round, hole: scoringEvents.hole })
    .from(scoringEvents)
    .where(eq(scoringEvents.gameId, gameId));

  const roundsStarted = new Set<number>();
  const roundsWithHole18 = new Set<number>();
  for (const r of rows) {
    if (r.round >= 1) {
      roundsStarted.add(r.round);
      if (r.hole === 18) roundsWithHole18.add(r.round);
    }
  }
  return detectSwapWindow({ roundsStarted, roundsWithHole18 });
}

/**
 * Top-pick cost for a golfer whose `position` string is e.g. "1", "T2",
 * "T15", etc. Returns 0 if outside the top 5 or unparseable.
 */
export function costForPosition(
  position: string | null,
  costs: readonly number[],
): number {
  if (!position) return 0;
  const m = /^T?(\d+)$/.exec(position.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 5) return 0;
  return costs[n - 1] ?? 0;
}

/**
 * Set of golfer ids currently held (active pick, endRound = 99) by any
 * participant in the given game.
 */
async function activelyHeldGolferIds(gameId: number): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ golferId: picks.golferId })
    .from(picks)
    .innerJoin(participants, eq(picks.participantId, participants.id))
    .where(and(eq(participants.gameId, gameId), eq(picks.endRound, 99)));
  return new Set(rows.map((r) => r.golferId));
}

/**
 * Golfers in this game's field that are NOT currently held by any
 * participant. Used to populate the substitution picker. Cut golfers
 * are excluded since they aren't playing anymore.
 */
export async function availableGolfersForSubstitution(gameId: number) {
  const held = await activelyHeldGolferIds(gameId);
  const allGolfers = await db
    .select({
      id: golfersTable.id,
      name: golfersTable.name,
      country: golfersTable.country,
      position: golfersTable.position,
      scoreToPar: golfersTable.scoreToPar,
      missedCut: golfersTable.missedCut,
    })
    .from(golfersTable)
    .where(eq(golfersTable.gameId, gameId));

  return allGolfers
    .filter((g) => !held.has(g.id) && g.missedCut === 0)
    .map((g) => ({
      id: g.id,
      name: g.name,
      country: g.country,
      position: g.position,
      scoreToPar: g.scoreToPar,
    }));
}

/**
 * Whether `participantId` can substitute right now. Returns null when
 * not, otherwise the open window. Reasons for null: no window open, the
 * participant has already subbed in the current window, the participant
 * isn't in this game, or the game is over.
 */
export async function canSubstitute(input: {
  gameId: number;
  participantId: number;
}): Promise<SwapWindow> {
  const [game] = await db.select().from(games).where(eq(games.id, input.gameId)).limit(1);
  if (!game) return null;
  if (game.status === 'post') return null;

  const window = await currentSwapWindow(input.gameId);
  if (!window) return null;

  // Has this participant already used this window?
  const used = await db
    .select({ id: substitutions.id })
    .from(substitutions)
    .where(
      and(
        eq(substitutions.participantId, input.participantId),
        eq(substitutions.window, window),
      ),
    )
    .limit(1);
  if (used.length > 0) return null;

  return window;
}

/**
 * Perform an atomic substitution. Validates everything, returns the new
 * substitution row's id and the cost charged.
 */
export async function performSubstitution(input: {
  gameId: number;
  participantId: number;
  /** id of the pick row to drop (must currently belong to this participant and be active). */
  droppedPickId: number;
  /** id of the golfer to add. Must be in the field and not held by anyone. */
  newGolferId: number;
}): Promise<{ substitutionId: number; costPoints: number; window: SubstitutionWindow }> {
  const [game] = await db
    .select()
    .from(games)
    .where(eq(games.id, input.gameId))
    .limit(1);
  if (!game) throw new Error('Game not found');

  const window = await canSubstitute({
    gameId: input.gameId,
    participantId: input.participantId,
  });
  if (!window) {
    throw new Error('No substitution window is open for you right now');
  }

  // Dropped pick must belong to the participant, be in this game, and be active.
  const [dropped] = await db
    .select()
    .from(picks)
    .where(eq(picks.id, input.droppedPickId))
    .limit(1);
  if (!dropped) throw new Error('Dropped pick not found');
  if (dropped.participantId !== input.participantId) {
    throw new Error("That pick isn't yours");
  }
  if (dropped.endRound !== 99) {
    throw new Error("That pick is no longer active");
  }

  // New golfer must be in this game's field, not cut, and not held by anyone.
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
  if (newGolfer.missedCut === 1) {
    throw new Error("That golfer missed the cut — pick someone still playing");
  }

  // Refuse re-picking a golfer the participant has previously held (uniqueness on picks).
  const priorPickOfNew = await db
    .select({ id: picks.id })
    .from(picks)
    .where(
      and(
        eq(picks.participantId, input.participantId),
        eq(picks.golferId, input.newGolferId),
      ),
    )
    .limit(1);
  if (priorPickOfNew.length > 0) {
    throw new Error("You've already had that golfer on your roster — pick someone new");
  }

  // Anyone currently holding the new golfer? (Active pick, endRound=99.)
  const heldByOthers = await db
    .select({ id: picks.id })
    .from(picks)
    .where(and(eq(picks.golferId, input.newGolferId), eq(picks.endRound, 99)))
    .limit(1);
  if (heldByOthers.length > 0) {
    throw new Error('That golfer is already on someone else\'s roster');
  }

  // Cost: look up the new golfer's current position. Use the live `position`
  // column from the field (last cron'd state).
  const cost = costForPosition(newGolfer.position, topPickCosts(game.scoringRules as ScoringRules));

  const droppedEndRound = endRoundForWindow(window);
  const newStartRound = droppedEndRound + 1;

  // Atomic-ish: drizzle/neon doesn't expose transactions on neon-http, so we
  // do the writes in a fixed order and log loudly if anything halfway through
  // throws. Most failure modes (uniqueness on substitutions, FK violations)
  // happen on the first write and abort cleanly.
  try {
    // 1. End the dropped pick.
    await db
      .update(picks)
      .set({ endRound: droppedEndRound })
      .where(eq(picks.id, input.droppedPickId));

    // 2. Insert the new pick.
    const [newPick] = await db
      .insert(picks)
      .values({
        participantId: input.participantId,
        golferId: input.newGolferId,
        startRound: newStartRound,
        endRound: 99,
      })
      .returning();

    // 3. Record the substitution. The unique index on
    //    (participant_id, window) is the canonical "one sub per window"
    //    enforcement.
    const [sub] = await db
      .insert(substitutions)
      .values({
        gameId: input.gameId,
        participantId: input.participantId,
        window,
        droppedPickId: input.droppedPickId,
        newPickId: newPick.id,
        costPoints: cost,
      })
      .returning();

    return { substitutionId: sub.id, costPoints: cost, window };
  } catch (error) {
    logError(error, {
      subsystem: 'substitutions',
      operation: 'perform_substitution',
      extra: {
        gameId: input.gameId,
        participantId: input.participantId,
        droppedPickId: input.droppedPickId,
        newGolferId: input.newGolferId,
        window,
      },
    });
    throw error;
  }
}
