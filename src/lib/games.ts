import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { games, golfers, participants, picks, type ScoringRules } from '@/db/schema';
import { fetchLeaderboard, parseField } from './espn';
import { generateGameCode, normalizeGameCode } from './code';
import { logError } from './log';

const MAX_CODE_RETRIES = 8;

export async function createGameWithField(input: {
  name: string;
  espnEventId: string;
  tournamentName: string;
  createdByName: string;
  scoringRules: ScoringRules;
}): Promise<{ gameId: number; code: string; creatorParticipantId: number }> {
  // 1. Generate a unique code.
  let code = generateGameCode();
  for (let i = 0; i < MAX_CODE_RETRIES; i++) {
    const taken = await db.select({ id: games.id }).from(games).where(eq(games.code, code)).limit(1);
    if (taken.length === 0) break;
    code = generateGameCode();
    if (i === MAX_CODE_RETRIES - 1) throw new Error('Could not generate a unique game code');
  }

  // 2. Pull the field from ESPN before creating the game so we fail fast
  //    if the event id is bogus.
  const lb = await fetchLeaderboard(input.espnEventId);
  const { field } = parseField(lb);
  if (field.length === 0) {
    throw new Error(`ESPN returned no competitors for event ${input.espnEventId}`);
  }

  // 3. Create the game row.
  const [game] = await db
    .insert(games)
    .values({
      code,
      name: input.name,
      espnEventId: input.espnEventId,
      tournamentName: input.tournamentName,
      scoringRules: input.scoringRules,
      createdByName: input.createdByName,
    })
    .returning();

  // 4. Seed the field.
  await db.insert(golfers).values(
    field.map((f) => ({
      gameId: game.id,
      espnAthleteId: f.espnAthleteId,
      name: f.name,
      country: f.country,
      position: f.position,
      scoreToPar: f.scoreToPar,
      missedCut: f.missedCut ? 1 : 0,
    })),
  );

  // 5. Create the creator as the first participant.
  const [creator] = await db
    .insert(participants)
    .values({ gameId: game.id, displayName: input.createdByName })
    .returning();

  return { gameId: game.id, code: game.code, creatorParticipantId: creator.id };
}

export async function joinGame(input: {
  code: string;
  displayName: string;
}): Promise<{ gameId: number; code: string; participantId: number }> {
  const code = normalizeGameCode(input.code);
  const [game] = await db.select().from(games).where(eq(games.code, code)).limit(1);
  if (!game) throw new Error('Game not found');

  // Try to find an existing participant with the same display name in this game.
  const existing = await db
    .select()
    .from(participants)
    .where(and(eq(participants.gameId, game.id), eq(participants.displayName, input.displayName)))
    .limit(1);

  if (existing.length > 0) {
    return { gameId: game.id, code: game.code, participantId: existing[0].id };
  }

  const [created] = await db
    .insert(participants)
    .values({ gameId: game.id, displayName: input.displayName })
    .returning();
  return { gameId: game.id, code: game.code, participantId: created.id };
}

export async function submitPicks(input: {
  participantId: number;
  golferIds: number[];
}): Promise<void> {
  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.id, input.participantId))
    .limit(1);
  if (!participant) throw new Error('Participant not found');
  if (participant.picksLocked === 1) throw new Error('Picks already locked');

  const [game] = await db.select().from(games).where(eq(games.id, participant.gameId)).limit(1);
  if (!game) throw new Error('Game not found');

  if (input.golferIds.length !== game.scoringRules.picks_per_user) {
    throw new Error(`You must pick exactly ${game.scoringRules.picks_per_user} golfers`);
  }

  // Verify all golfers belong to this game.
  const validGolfers = await db
    .select({ id: golfers.id })
    .from(golfers)
    .where(eq(golfers.gameId, participant.gameId));
  const validIds = new Set(validGolfers.map((g) => g.id));
  for (const id of input.golferIds) {
    if (!validIds.has(id)) throw new Error(`Golfer ${id} is not part of this game`);
  }

  // No duplicates.
  if (new Set(input.golferIds).size !== input.golferIds.length) {
    throw new Error('You cannot pick the same golfer twice');
  }

  // Insert picks then lock.
  try {
    await db.insert(picks).values(
      input.golferIds.map((golferId) => ({
        participantId: participant.id,
        golferId,
      })),
    );
    await db
      .update(participants)
      .set({ picksLocked: 1 })
      .where(eq(participants.id, participant.id));
  } catch (error) {
    logError(error, {
      subsystem: 'games',
      operation: 'submit_picks',
      extra: { participantId: participant.id, golferIds: input.golferIds },
    });
    throw error;
  }
}

export async function getGameByCode(code: string) {
  const [game] = await db
    .select()
    .from(games)
    .where(eq(games.code, normalizeGameCode(code)))
    .limit(1);
  return game ?? null;
}
