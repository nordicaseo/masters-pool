import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  games,
  golfers,
  participants,
  picks,
  scoringEvents,
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

  // Update game status if changed.
  if (state !== game.status) {
    await db.update(games).set({ status: state }).where(eq(games.id, gameId));
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

async function awardFinishBonuses(
  gameId: number,
  field: FieldRow[],
  rules: ScoringRules,
): Promise<number> {
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

  // Walk podium positions 1, 2, 3 — accounting for ties.
  const podium: Array<{ kind: ScoringEventKind; rows: typeof eligible; points: number }> = [];
  let positionFilled = 0;
  for (const bucket of buckets) {
    if (positionFilled >= 3) break;
    const placeKinds: ScoringEventKind[] = ['finish_1', 'finish_2', 'finish_3'];
    // The current bucket occupies positions [positionFilled+1 .. positionFilled+bucket.rows.length].
    const filledPositions = placeKinds
      .slice(positionFilled, positionFilled + bucket.rows.length)
      .filter(Boolean);
    if (filledPositions.length === 0) {
      positionFilled += bucket.rows.length;
      continue;
    }
    const totalPoints = filledPositions
      .map((k) => pointsForKind(rules, k))
      .reduce((a, b) => a + b, 0);
    const perGolfer =
      rules.tie_handling === 'split_floor'
        ? Math.floor(totalPoints / bucket.rows.length)
        : totalPoints;
    // Use the highest finishing kind in the bucket as the event kind so the
    // idempotency key stays stable across re-runs.
    const eventKind = filledPositions[0]!;
    podium.push({ kind: eventKind, rows: bucket.rows, points: perGolfer });
    positionFilled += bucket.rows.length;
  }

  if (podium.length === 0) return 0;

  // Resolve athlete ids → golfer ids.
  const allAthleteIds = podium.flatMap((p) => p.rows.map((r) => r.espnAthleteId));
  const golferRows = await db
    .select({ id: golfers.id, espnAthleteId: golfers.espnAthleteId })
    .from(golfers)
    .where(and(eq(golfers.gameId, gameId), inArray(golfers.espnAthleteId, allAthleteIds)));
  const byAthlete = new Map(golferRows.map((g) => [g.espnAthleteId, g.id]));

  let inserted = 0;
  for (const place of podium) {
    for (const row of place.rows) {
      const golferId = byAthlete.get(row.espnAthleteId);
      if (!golferId) continue;
      const r = await db
        .insert(scoringEvents)
        .values({
          gameId,
          golferId,
          kind: place.kind,
          round: 0,
          hole: 0,
          points: place.points,
        })
        .onConflictDoNothing()
        .returning({ id: scoringEvents.id });
      inserted += r.length;
    }
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
  picks: Array<{ golferId: number; name: string; points: number; missedCut: boolean; position: string | null }>;
};

export async function participantTotals(gameId: number): Promise<ParticipantTotal[]> {
  const parts = await db
    .select()
    .from(participants)
    .where(eq(participants.gameId, gameId));

  const golferTotalsList = await golferTotals(gameId);
  const totalByGolfer = new Map(golferTotalsList.map((g) => [g.golferId, g]));

  const result: ParticipantTotal[] = [];
  for (const p of parts) {
    const pickRows = await db
      .select({ golferId: picks.golferId, name: golfers.name })
      .from(picks)
      .innerJoin(golfers, eq(picks.golferId, golfers.id))
      .where(eq(picks.participantId, p.id));

    const enriched = pickRows.map((pk) => {
      const t = totalByGolfer.get(pk.golferId);
      return {
        golferId: pk.golferId,
        name: pk.name,
        points: t?.points ?? 0,
        missedCut: t?.missedCut ?? false,
        position: t?.position ?? null,
      };
    });

    result.push({
      participantId: p.id,
      displayName: p.displayName,
      points: enriched.reduce((sum, e) => sum + e.points, 0),
      picks: enriched,
    });
  }

  return result.sort((a, b) => b.points - a.points);
}
