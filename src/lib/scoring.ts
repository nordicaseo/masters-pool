import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  games,
  golfers,
  participants,
  picks,
  scoringEvents,
  substitutions,
  type ScoringEventKind,
  type ScoringRules,
} from '@/db/schema';
import {
  fetchCompetitorSummary,
  fetchLeaderboard,
  parseField,
  parseHoleEvents,
  type FieldRow,
} from './espn';
import { logError, logInfo } from './log';

export function pointsForKind(rules: ScoringRules, kind: ScoringEventKind): number {
  switch (kind) {
    case 'birdie':
      return rules.birdie;
    case 'eagle':
      return rules.eagle;
    case 'albatross':
      return rules.albatross;
    case 'hole_in_one':
      return rules.hole_in_one;
    case 'bogey':
      return rules.bogey;
    case 'double_bogey':
      return rules.double_bogey;
    case 'triple_plus':
      return rules.triple_plus;
    case 'finish_1':
      return rules.finish_1;
    case 'finish_2':
      return rules.finish_2;
    case 'finish_3':
      return rules.finish_3;
    case 'missed_cut':
      return 0;
  }
}

/**
 * Sync a single game from ESPN.
 *
 * Steps:
 *   1. Fetch leaderboard, upsert field rows on `golfers`.
 *   2. For every golfer that someone in the pool has picked, fetch their
 *      competitor summary and insert any new (round, hole, kind) events.
 *   3. If tournament status is "post", award finish bonuses (1st/2nd/3rd)
 *      handling ties via the game's tie_handling rule.
 *   4. Mark cut golfers and write a one-shot `missed_cut` event so the UI
 *      can render the beer badge.
 *
 * The whole thing is idempotent — re-running it will not double-count.
 */
export async function syncGame(gameId: number): Promise<{ updated: number; events: number }> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) throw new Error(`Game ${gameId} not found`);

  const lb = await fetchLeaderboard(game.espnEventId);
  const { state, field } = parseField(lb);

  // 1. Upsert golfers in the field.
  let updatedGolfers = 0;
  for (const row of field) {
    updatedGolfers += await upsertGolfer(gameId, row);
  }

  // 2. Fetch per-hole events only for golfers actually picked by someone.
  const pickedGolferIds = await pickedGolfersForGame(gameId);
  let newEvents = 0;
  for (const g of pickedGolferIds) {
    try {
      newEvents += await syncGolferHoles(game.id, game.espnEventId, g.id, g.espnAthleteId, game.scoringRules);
    } catch (error) {
      logError(error, {
        subsystem: 'espn',
        operation: 'sync_golfer_holes',
        extra: { gameId, golferId: g.id, espnAthleteId: g.espnAthleteId },
      });
      // Keep going for other golfers — one bad fetch shouldn't break the cron.
    }
  }

  // 3. Cut handling — write a missed_cut marker once per cut golfer.
  newEvents += await writeMissedCutMarkers(gameId, field, game.scoringRules);

  // 4. Finish bonuses — only when the tournament is final.
  if (state === 'post') {
    newEvents += await awardFinishBonuses(gameId, field, game.scoringRules);
  }

  // 5. Commit the new status last. The cron filter skips games with
  //    status='post', so if we set 'post' earlier and a downstream step
  //    (hole sync, missed-cut markers, finish bonuses) threw, the game
  //    would be marked final but missing events — and never retried.
  //    By updating status only after all event-writing work has succeeded,
  //    any partial failure leaves the previous status in place and the
  //    next cron tick re-runs the whole sync idempotently.
  if (state !== game.status) {
    await db.update(games).set({ status: state }).where(eq(games.id, gameId));
  }

  logInfo('game synced', {
    subsystem: 'scoring',
    operation: 'sync_game',
    extra: { gameId, state, updatedGolfers, newEvents },
  });

  return { updated: updatedGolfers, events: newEvents };
}

async function upsertGolfer(gameId: number, row: FieldRow): Promise<number> {
  const existing = await db
    .select()
    .from(golfers)
    .where(and(eq(golfers.gameId, gameId), eq(golfers.espnAthleteId, row.espnAthleteId)))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(golfers).values({
      gameId,
      espnAthleteId: row.espnAthleteId,
      name: row.name,
      country: row.country,
      position: row.position,
      scoreToPar: row.scoreToPar,
      missedCut: row.missedCut ? 1 : 0,
    });
    return 1;
  }

  const before = existing[0];
  const newCut = row.missedCut ? 1 : 0;
  if (
    before.position === row.position &&
    before.scoreToPar === row.scoreToPar &&
    before.missedCut === newCut &&
    before.name === row.name
  ) {
    return 0;
  }

  await db
    .update(golfers)
    .set({
      name: row.name,
      country: row.country,
      position: row.position,
      scoreToPar: row.scoreToPar,
      missedCut: newCut,
    })
    .where(eq(golfers.id, before.id));
  return 1;
}

async function pickedGolfersForGame(gameId: number): Promise<Array<{ id: number; espnAthleteId: string }>> {
  const rows = await db
    .selectDistinct({ id: golfers.id, espnAthleteId: golfers.espnAthleteId })
    .from(picks)
    .innerJoin(participants, eq(picks.participantId, participants.id))
    .innerJoin(golfers, eq(picks.golferId, golfers.id))
    .where(eq(participants.gameId, gameId));
  return rows;
}

async function syncGolferHoles(
  gameId: number,
  eventId: string,
  golferId: number,
  espnAthleteId: string,
  rules: ScoringRules,
): Promise<number> {
  const summary = await fetchCompetitorSummary(eventId, espnAthleteId);
  const events = parseHoleEvents(summary);
  if (events.length === 0) return 0;

  // Read what we already have for this golfer so we only insert deltas.
  const existing = await db
    .select({ kind: scoringEvents.kind, round: scoringEvents.round, hole: scoringEvents.hole })
    .from(scoringEvents)
    .where(and(eq(scoringEvents.gameId, gameId), eq(scoringEvents.golferId, golferId)));

  const seen = new Set(existing.map((e) => `${e.kind}:${e.round}:${e.hole}`));

  const toInsert = events
    .filter((e) => !seen.has(`${e.kind}:${e.round}:${e.hole}`))
    .map((e) => ({
      gameId,
      golferId,
      kind: e.kind,
      round: e.round,
      hole: e.hole,
      points: pointsForKind(rules, e.kind),
    }));

  if (toInsert.length === 0) return 0;
  await db.insert(scoringEvents).values(toInsert).onConflictDoNothing();
  return toInsert.length;
}

async function writeMissedCutMarkers(
  gameId: number,
  field: FieldRow[],
  rules: ScoringRules,
): Promise<number> {
  const cut = field.filter((f) => f.missedCut);
  if (cut.length === 0) return 0;

  const golferRows = await db
    .select({ id: golfers.id, espnAthleteId: golfers.espnAthleteId })
    .from(golfers)
    .where(
      and(
        eq(golfers.gameId, gameId),
        inArray(
          golfers.espnAthleteId,
          cut.map((c) => c.espnAthleteId),
        ),
      ),
    );

  let inserted = 0;
  for (const g of golferRows) {
    const r = await db
      .insert(scoringEvents)
      .values({
        gameId,
        golferId: g.id,
        kind: 'missed_cut' as ScoringEventKind,
        round: 0,
        hole: 0,
        points: pointsForKind(rules, 'missed_cut'),
      })
      .onConflictDoNothing()
      .returning({ id: scoringEvents.id });
    inserted += r.length;
  }
  return inserted;
}

export type FinishBonusAward = {
  kind: ScoringEventKind;
  espnAthleteId: string;
  points: number;
};

/**
 * Pure computation of finish bonuses from a parsed leaderboard.
 *
 * Walks the field in finishing order and assigns each bucket of tied
 * golfers a per-golfer point value based on the game's `tie_handling`:
 *
 *   - `split_floor`: the tied bucket absorbs the sum of the places it
 *     spans (e.g. 4-way tie at 1st spans finish_1+finish_2+finish_3) and
 *     the pool is divided evenly with `Math.floor`.
 *   - `full`: every tied golfer gets the point value of the **highest**
 *     place they're tied at (e.g. 4-way tie at 1st pays `finish_1` to
 *     each). Lower contested places are not paid out — this matches the
 *     natural reading of "full to each tied golfer" and avoids the
 *     previous behavior of paying each tied golfer the *sum* of all
 *     spanned places (which inflated payouts way past the intended pool).
 *
 * The event `kind` is always the highest place in the bucket so that
 * the `(game_id, golfer_id, kind, round, hole)` idempotency key stays
 * stable across re-runs.
 */
export function computeFinishBonuses(
  field: FieldRow[],
  rules: ScoringRules,
): FinishBonusAward[] {
  // Group by numeric position (strip "T" prefix). Skip cut/withdrawn.
  const eligible = field
    .filter((f) => !f.missedCut && f.position && /^T?\d+$/.test(f.position))
    .map((f) => ({ ...f, posNum: Number(f.position!.replace(/^T/, '')) }))
    .sort((a, b) => a.posNum - b.posNum);

  type Bucket = { posNum: number; rows: typeof eligible };
  const buckets: Bucket[] = [];
  for (const r of eligible) {
    const last = buckets[buckets.length - 1];
    if (last && last.posNum === r.posNum) last.rows.push(r);
    else buckets.push({ posNum: r.posNum, rows: [r] });
  }

  const placeKinds: ScoringEventKind[] = ['finish_1', 'finish_2', 'finish_3'];
  const awards: FinishBonusAward[] = [];
  let positionFilled = 0;
  for (const bucket of buckets) {
    if (positionFilled >= placeKinds.length) break;
    // The current bucket occupies positions [positionFilled+1 .. positionFilled+bucket.rows.length].
    const filledPositions = placeKinds.slice(
      positionFilled,
      positionFilled + bucket.rows.length,
    );
    if (filledPositions.length === 0) {
      positionFilled += bucket.rows.length;
      continue;
    }
    const eventKind = filledPositions[0]!;
    const perGolfer =
      rules.tie_handling === 'split_floor'
        ? Math.floor(
            filledPositions
              .map((k) => pointsForKind(rules, k))
              .reduce((a, b) => a + b, 0) / bucket.rows.length,
          )
        : pointsForKind(rules, eventKind);
    for (const row of bucket.rows) {
      awards.push({ kind: eventKind, espnAthleteId: row.espnAthleteId, points: perGolfer });
    }
    positionFilled += bucket.rows.length;
  }

  return awards;
}

async function awardFinishBonuses(
  gameId: number,
  field: FieldRow[],
  rules: ScoringRules,
): Promise<number> {
  const awards = computeFinishBonuses(field, rules);
  if (awards.length === 0) return 0;

  // Resolve athlete ids → golfer ids.
  const allAthleteIds = awards.map((a) => a.espnAthleteId);
  const golferRows = await db
    .select({ id: golfers.id, espnAthleteId: golfers.espnAthleteId })
    .from(golfers)
    .where(and(eq(golfers.gameId, gameId), inArray(golfers.espnAthleteId, allAthleteIds)));
  const byAthlete = new Map(golferRows.map((g) => [g.espnAthleteId, g.id]));

  let inserted = 0;
  for (const award of awards) {
    const golferId = byAthlete.get(award.espnAthleteId);
    if (!golferId) continue;
    const r = await db
      .insert(scoringEvents)
      .values({
        gameId,
        golferId,
        kind: award.kind,
        round: 0,
        hole: 0,
        points: award.points,
      })
      .onConflictDoNothing()
      .returning({ id: scoringEvents.id });
    inserted += r.length;
  }
  return inserted;
}

// ---------- aggregations for the leaderboards ----------

export type GolferTotal = {
  golferId: number;
  espnAthleteId: string;
  name: string;
  country: string | null;
  position: string | null;
  scoreToPar: number | null;
  missedCut: boolean;
  points: number;
};

export async function golferTotals(gameId: number): Promise<GolferTotal[]> {
  const rows = await db
    .select({
      golferId: golfers.id,
      espnAthleteId: golfers.espnAthleteId,
      name: golfers.name,
      country: golfers.country,
      position: golfers.position,
      scoreToPar: golfers.scoreToPar,
      missedCut: golfers.missedCut,
      points: sql<number>`COALESCE(SUM(${scoringEvents.points}), 0)::int`,
    })
    .from(golfers)
    .leftJoin(scoringEvents, eq(scoringEvents.golferId, golfers.id))
    .where(eq(golfers.gameId, gameId))
    .groupBy(golfers.id);

  return rows
    .map((r) => ({ ...r, missedCut: r.missedCut === 1 }))
    .sort((a, b) => b.points - a.points);
}

export type ParticipantTotal = {
  participantId: number;
  displayName: string;
  points: number;
  /** ACTIVE picks (endRound = 99) — the participant's current roster. */
  picks: Array<{ golferId: number; name: string; points: number; missedCut: boolean; position: string | null }>;
  /** Total negative cost from any substitutions the participant has used. */
  substitutionCost: number;
};

/**
 * Whether a `scoring_events` row counts toward a given pick's bounded
 * active period.
 *
 * Per-hole events (round 1..4): event.round must fall in
 * [pick.startRound, pick.endRound].
 *
 * Round-0 events (finish bonuses, missed_cut markers) represent
 * end-of-tournament outcomes — they only count for a pick that the
 * participant is still holding at the end (endRound = 99).
 */
export function eventCountsForPick(
  event: { round: number },
  pick: { startRound: number; endRound: number },
): boolean {
  if (event.round === 0) return pick.endRound === 99;
  return event.round >= pick.startRound && event.round <= pick.endRound;
}

export async function participantTotals(gameId: number): Promise<ParticipantTotal[]> {
  // 1. Roster.
  const parts = await db
    .select({ id: participants.id, displayName: participants.displayName })
    .from(participants)
    .where(eq(participants.gameId, gameId));
  if (parts.length === 0) return [];

  // 2. Every pick in this game (active + already-dropped).
  const allPicks = await db
    .select({
      id: picks.id,
      participantId: picks.participantId,
      golferId: picks.golferId,
      startRound: picks.startRound,
      endRound: picks.endRound,
      name: golfers.name,
      missedCut: golfers.missedCut,
      position: golfers.position,
    })
    .from(picks)
    .innerJoin(golfers, eq(picks.golferId, golfers.id))
    .innerJoin(participants, eq(picks.participantId, participants.id))
    .where(eq(participants.gameId, gameId));

  // 3. Every scoring event in this game.
  const events = await db
    .select({
      golferId: scoringEvents.golferId,
      round: scoringEvents.round,
      points: scoringEvents.points,
    })
    .from(scoringEvents)
    .where(eq(scoringEvents.gameId, gameId));

  // 4. Substitution costs per participant.
  const subs = await db
    .select({
      participantId: substitutions.participantId,
      costPoints: substitutions.costPoints,
    })
    .from(substitutions)
    .where(eq(substitutions.gameId, gameId));

  // Index events by golfer for O(picks + events) scoring.
  const eventsByGolfer = new Map<number, Array<{ round: number; points: number }>>();
  for (const e of events) {
    const arr = eventsByGolfer.get(e.golferId) ?? [];
    arr.push({ round: e.round, points: e.points });
    eventsByGolfer.set(e.golferId, arr);
  }

  const subCostByParticipant = new Map<number, number>();
  for (const s of subs) {
    subCostByParticipant.set(
      s.participantId,
      (subCostByParticipant.get(s.participantId) ?? 0) + s.costPoints,
    );
  }

  const result: ParticipantTotal[] = [];
  for (const part of parts) {
    let earned = 0;
    const activePicks: ParticipantTotal['picks'] = [];

    for (const pk of allPicks) {
      if (pk.participantId !== part.id) continue;
      const golferEvents = eventsByGolfer.get(pk.golferId) ?? [];
      const pickPoints = golferEvents
        .filter((e) => eventCountsForPick(e, pk))
        .reduce((s, e) => s + e.points, 0);
      earned += pickPoints;

      if (pk.endRound === 99) {
        activePicks.push({
          golferId: pk.golferId,
          name: pk.name,
          points: pickPoints,
          missedCut: pk.missedCut === 1,
          position: pk.position,
        });
      }
    }

    const subCost = subCostByParticipant.get(part.id) ?? 0;
    result.push({
      participantId: part.id,
      displayName: part.displayName,
      points: earned + subCost, // costPoints stored as negative integers
      picks: activePicks,
      substitutionCost: subCost,
    });
  }

  return result.sort((a, b) => b.points - a.points);
}
