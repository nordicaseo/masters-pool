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
  createdByUserId: string;
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

  // 2. Pull the field from ESPN so we fail fast if the event id is bogus.
  //    An empty field is OK and expected for tournaments more than a day or
  //    two out (ESPN doesn't publish the tee sheet that early). The cron
  //    will seed the field once it appears.
  const lb = await fetchLeaderboard(input.espnEventId);
  const { field } = parseField(lb);

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

  // 4. Seed the field if ESPN has it. Otherwise leave golfers empty;
  //    syncGame() in src/lib/scoring.ts will upsert them when the field
  //    is published.
  if (field.length > 0) {
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
  }

  // 5. Create the creator as the first participant, tied to their Clerk user.
  const [creator] = await db
    .insert(participants)
    .values({
      gameId: game.id,
      userId: input.createdByUserId,
      displayName: input.createdByName,
    })
    .returning();

  return { gameId: game.id, code: game.code, creatorParticipantId: creator.id };
}

export async function joinGame(input: {
  code: string;
  displayName: string;
  userId: string;
}): Promise<{ gameId: number; code: string; participantId: number; alreadyJoined: boolean }> {
  const code = normalizeGameCode(input.code);
  const [game] = await db.select().from(games).where(eq(games.code, code)).limit(1);
  if (!game) throw new Error('Game not found');

  // Already joined? Return their existing participant row.
  const existing = await db
    .select()
    .from(participants)
    .where(and(eq(participants.gameId, game.id), eq(participants.userId, input.userId)))
    .limit(1);
  if (existing.length > 0) {
    return {
      gameId: game.id,
      code: game.code,
      participantId: existing[0].id,
      alreadyJoined: true,
    };
  }

  // Display-name uniqueness within a pool is enforced by the DB. If two
  // friends pick the same name they'll get a clear error from the unique
  // index and can pick a different one.
  try {
    const [created] = await db
      .insert(participants)
      .values({
        gameId: game.id,
        userId: input.userId,
        displayName: input.displayName,
      })
      .returning();
    return { gameId: game.id, code: game.code, participantId: created.id, alreadyJoined: false };
  } catch (error) {
    // unique_violation on (game_id, display_name)
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('participants_game_name_unique')) {
      throw new Error(`The name "${input.displayName}" is already taken in this pool`);
    }
    throw error;
  }
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
