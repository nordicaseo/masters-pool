/**
 * Homepage aggregate stats. Counts beers/hot-dogs/players across every
 * pool currently in `pre` or `in` status so the landing page can advertise
 * what's at stake on a given weekend.
 *
 * Kept deliberately cheap — four simple queries against small tables on
 * Neon serverless (latency ~10-30ms). The homepage is `force-dynamic`
 * already so this runs on every request, but the numbers are too fun to
 * stale-cache.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { games, golfers, participants, picks } from '@/db/schema';

export type HomepageStats = {
  /** Count of active pools (`status IN (pre, in)`). */
  activePools: number;
  /** Count of unique participants across active pools. */
  activePlayers: number;
  /**
   * Beers on the line: cut golfers currently on someone's active roster
   * across every pool in any status. Each cut pick = one beer.
   */
  beersOnTheLine: number;
  /** Pools whose `stakes` text contains "hot dog" / "soup" / "pizza" — keyword counts. */
  stakeMentions: {
    hotDogs: number;
    soups: number;
    pizzas: number;
    other: number; // pools with a stakes value not matching the above
  };
};

const STATES_ACTIVE = ['pre', 'in'] as const;

export async function getHomepageStats(): Promise<HomepageStats> {
  // Active pools — id list reused below.
  const activeGames = await db
    .select({ id: games.id, stakes: games.stakes })
    .from(games)
    .where(inArray(games.status, STATES_ACTIVE as unknown as string[]));

  const activePools = activeGames.length;
  const activeIds = activeGames.map((g) => g.id);

  // Distinct participants across the active pools. If there are no active
  // pools we skip this query to avoid a confusing `where IN ()`.
  let activePlayers = 0;
  if (activeIds.length > 0) {
    const rows = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${participants.id})::int` })
      .from(participants)
      .where(inArray(participants.gameId, activeIds));
    activePlayers = rows[0]?.count ?? 0;
  }

  // Beers — currently-active picks whose golfer is missed_cut. We count
  // across ALL pools, not just active ones, because a beer earned in a
  // finished pool is still a beer the pool owner remembers fondly.
  const beerRows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(picks)
    .innerJoin(golfers, eq(golfers.id, picks.golferId))
    .where(and(eq(picks.endRound, 99), eq(golfers.missedCut, 1)));
  const beersOnTheLine = beerRows[0]?.count ?? 0;

  // Stake-keyword counts. Free-text matching is fuzzy ("a hot dog and a
  // diet coke" matches hotDogs). Done in JS so callers can read the
  // pattern.
  const stakeMentions = {
    hotDogs: 0,
    soups: 0,
    pizzas: 0,
    other: 0,
  };
  for (const g of activeGames) {
    if (!g.stakes) continue;
    const lower = g.stakes.toLowerCase();
    let matched = false;
    if (lower.includes('hot dog') || lower.includes('hotdog')) {
      stakeMentions.hotDogs += 1;
      matched = true;
    }
    if (lower.includes('soup')) {
      stakeMentions.soups += 1;
      matched = true;
    }
    if (lower.includes('pizza')) {
      stakeMentions.pizzas += 1;
      matched = true;
    }
    if (!matched) stakeMentions.other += 1;
  }

  return { activePools, activePlayers, beersOnTheLine, stakeMentions };
}
