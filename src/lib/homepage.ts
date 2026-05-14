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
import {
  games,
  golfers,
  participants,
  picks,
  type StakeItems,
} from '@/db/schema';

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
  /**
   * Real, summed stake quantities across all active pools. Pulled from
   * the structured `stake_items` JSONB; pools created before that field
   * existed contribute nothing here (their free-text `stakes` is not
   * keyword-scanned anymore — the structured form is the source of truth
   * going forward).
   */
  stakeTotals: {
    beers: number;
    hotDogs: number;
    hotSoup: number;
    /** Number of active pools with a non-empty `other` field. */
    other: number;
  };
};

const STATES_ACTIVE = ['pre', 'in'] as const;

export async function getHomepageStats(): Promise<HomepageStats> {
  // Active pools — id list reused below.
  const activeGames = await db
    .select({ id: games.id, stakeItems: games.stakeItems })
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

  // Sum structured stake quantities. Pools without `stake_items` are
  // silently ignored — the legacy text-keyword scan was fuzzy and made
  // for misleading totals; better to under-report than misreport.
  const stakeTotals = { beers: 0, hotDogs: 0, hotSoup: 0, other: 0 };
  for (const g of activeGames) {
    const items = g.stakeItems as StakeItems | null;
    if (!items) continue;
    stakeTotals.beers += items.beers ?? 0;
    stakeTotals.hotDogs += items.hotDogs ?? 0;
    stakeTotals.hotSoup += items.hotSoup ?? 0;
    if (items.other?.trim()) stakeTotals.other += 1;
  }

  return { activePools, activePlayers, beersOnTheLine, stakeTotals };
}
