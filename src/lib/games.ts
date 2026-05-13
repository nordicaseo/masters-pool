import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  games,
  golfers,
  participants,
  picks,
  type DraftMode,
  type RosterMode,
  type ScoringRules,
} from '@/db/schema';
import { fetchLeaderboard, parseField } from './espn';
import { generateGameCode, normalizeGameCode } from './code';
import { logError } from './log';
import { nextSlot, shuffleWithSeed } from './draft';

const MAX_CODE_RETRIES = 8;

export async function createGameWithField(input: {
  name: string;
  espnEventId: string;
  tournamentName: string;
  createdByName: string;
  createdByUserId: string;
  scoringRules: ScoringRules;
  rosterMode: RosterMode;
  draftMode: DraftMode;
  maxPlayers?: number;
  /** Names of manual participants, when rosterMode === 'manual'. The
   *  creator is added separately as participant 1; these are players 2..N. */
  manualPlayerNames?: string[];
}): Promise<{ gameId: number; code: string; creatorParticipantId: number }> {
  // 1. Generate a unique code.
  let code = generateGameCode();
  for (let i = 0; i < MAX_CODE_RETRIES; i++) {
    const taken = await db.select({ id: games.id }).from(games).where(eq(games.code, code)).limit(1);
    if (taken.length === 0) break;
    code = generateGameCode();
    if (i === MAX_CODE_RETRIES - 1) throw new Error('Could not generate a unique game code');
  }

  // 2. Resolve max_players based on roster + draft mode.
  let maxPlayers: number | null = null;
  if (input.draftMode === 'snake') {
    if (input.rosterMode === 'manual') {
      // Creator + manual players.
      const manualCount = (input.manualPlayerNames ?? []).length;
      maxPlayers = 1 + manualCount;
    } else if (typeof input.maxPlayers === 'number') {
      maxPlayers = input.maxPlayers;
    } else {
      throw new Error('Snake draft requires a player count');
    }
  }

  // 3. Pull the field from ESPN so we fail fast if the event id is bogus.
  //    An empty field is OK and expected for tournaments more than a day or
  //    two out (ESPN doesn't publish the tee sheet that early).
  const lb = await fetchLeaderboard(input.espnEventId);
  const { field } = parseField(lb);

  // 4. Create the game row.
  const [game] = await db
    .insert(games)
    .values({
      code,
      name: input.name,
      espnEventId: input.espnEventId,
      tournamentName: input.tournamentName,
      scoringRules: input.scoringRules,
      createdByName: input.createdByName,
      createdByUserId: input.createdByUserId,
      rosterMode: input.rosterMode,
      draftMode: input.draftMode,
      maxPlayers,
    })
    .returning();

  // 5. Seed the field if ESPN has it.
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

  // 6. Create the creator as the first participant. They get a Clerk
  //    user_id so they can act as themselves.
  const [creator] = await db
    .insert(participants)
    .values({
      gameId: game.id,
      userId: input.createdByUserId,
      displayName: input.createdByName,
    })
    .returning();

  // 7. Manual roster: add the rest of the players (user_id = NULL).
  if (input.rosterMode === 'manual' && input.manualPlayerNames?.length) {
    const rows = input.manualPlayerNames.map((displayName) => ({
      gameId: game.id,
      userId: null as string | null,
      displayName,
    }));
    try {
      await db.insert(participants).values(rows);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('participants_game_name_unique')) {
        throw new Error('Duplicate player names in the manual roster — every name must be unique');
      }
      throw error;
    }
  }

  // 8. If the roster is already full at creation (Manual+Snake always is),
  //    randomize pick_order and start the draft now.
  if (input.draftMode === 'snake' && maxPlayers !== null) {
    await tryStartSnakeDraft(game.id, maxPlayers);
  }

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

  if (game.rosterMode === 'manual') {
    // Already joined? Manual rosters have NULL user_ids, but the creator
    // is tied to a real user_id, so this still resolves cleanly.
    const [mine] = await db
      .select()
      .from(participants)
      .where(and(eq(participants.gameId, game.id), eq(participants.userId, input.userId)))
      .limit(1);
    if (mine) {
      return {
        gameId: game.id,
        code: game.code,
        participantId: mine.id,
        alreadyJoined: true,
      };
    }
    throw new Error('This pool has a manual roster — only players the creator added can play');
  }

  // Open roster — already joined?
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

  // For snake-mode pools, refuse if already at max.
  if (game.draftMode === 'snake' && game.maxPlayers !== null) {
    const all = await db
      .select({ id: participants.id })
      .from(participants)
      .where(eq(participants.gameId, game.id));
    if (all.length >= game.maxPlayers) {
      throw new Error('This pool is full');
    }
  }

  try {
    const [created] = await db
      .insert(participants)
      .values({
        gameId: game.id,
        userId: input.userId,
        displayName: input.displayName,
      })
      .returning();

    // After every new join in Open+Snake, see if we just hit max — if so,
    // randomize the draft order.
    if (game.draftMode === 'snake' && game.maxPlayers !== null) {
      await tryStartSnakeDraft(game.id, game.maxPlayers);
    }
    return { gameId: game.id, code: game.code, participantId: created.id, alreadyJoined: false };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('participants_game_name_unique')) {
      throw new Error(`The name "${input.displayName}" is already taken in this pool`);
    }
    throw error;
  }
}

/**
 * If the participant count for this game equals `maxPlayers`, randomize
 * pick_order and set `draftStartedAt`. Idempotent — runs only if no
 * participant in this game already has a pick_order.
 */
async function tryStartSnakeDraft(gameId: number, maxPlayers: number): Promise<void> {
  const rows = await db
    .select({ id: participants.id, pickOrder: participants.pickOrder })
    .from(participants)
    .where(eq(participants.gameId, gameId));
  if (rows.length < maxPlayers) return; // roster not full yet
  if (rows.some((r) => r.pickOrder !== null)) return; // already started

  const seed = Math.floor(Math.random() * 1e9);
  const shuffled = shuffleWithSeed(rows, seed);
  for (let i = 0; i < shuffled.length; i++) {
    await db
      .update(participants)
      .set({ pickOrder: i + 1 })
      .where(eq(participants.id, shuffled[i].id));
  }
  await db.update(games).set({ draftStartedAt: new Date() }).where(eq(games.id, gameId));
}

/**
 * Free-mode pick submission. Submits all K golfers in one shot and
 * locks the participant. Existing behavior preserved.
 */
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
  if (game.draftMode !== 'free') {
    throw new Error('This pool uses snake-draft picks, one at a time');
  }

  if (input.golferIds.length !== game.scoringRules.picks_per_user) {
    throw new Error(`You must pick exactly ${game.scoringRules.picks_per_user} golfers`);
  }

  const validGolfers = await db
    .select({ id: golfers.id })
    .from(golfers)
    .where(eq(golfers.gameId, participant.gameId));
  const validIds = new Set(validGolfers.map((g) => g.id));
  for (const id of input.golferIds) {
    if (!validIds.has(id)) throw new Error(`Golfer ${id} is not part of this game`);
  }

  if (new Set(input.golferIds).size !== input.golferIds.length) {
    throw new Error('You cannot pick the same golfer twice');
  }

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

/**
 * Snake-draft single-golfer pick. Enforces:
 *   - draft mode is `snake` and draft has started
 *   - it's this participant's turn (matches the snake order)
 *   - the golfer is in the game and hasn't been picked by anyone yet
 *   - the participant hasn't already filled all K of their picks
 *
 * Marks `picksLocked = 1` on the participant once they've picked K times.
 */
export async function pickOneGolfer(input: {
  participantId: number;
  golferId: number;
}): Promise<{ pickCount: number; isComplete: boolean }> {
  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.id, input.participantId))
    .limit(1);
  if (!participant) throw new Error('Participant not found');

  const [game] = await db
    .select()
    .from(games)
    .where(eq(games.id, participant.gameId))
    .limit(1);
  if (!game) throw new Error('Game not found');
  if (game.draftMode !== 'snake') {
    throw new Error('This pool uses free-mode picks');
  }
  if (game.draftStartedAt === null || game.maxPlayers === null) {
    throw new Error('Draft has not started yet');
  }
  if (participant.pickOrder === null) {
    throw new Error('Pick order not assigned');
  }

  const k = game.scoringRules.picks_per_user;
  const n = game.maxPlayers;

  // Verify it's this participant's turn.
  const allPicks = await db
    .select({
      id: picks.id,
      golferId: picks.golferId,
      participantId: picks.participantId,
    })
    .from(picks)
    .innerJoin(participants, eq(picks.participantId, participants.id))
    .where(eq(participants.gameId, game.id));
  if (allPicks.length >= n * k) throw new Error('Draft is complete');

  const expectedSlot = nextSlot(allPicks.length, n, k);
  if (expectedSlot !== participant.pickOrder) {
    throw new Error("It's not your turn");
  }

  // Golfer must exist in the game and not be picked already.
  const [golfer] = await db
    .select({ id: golfers.id })
    .from(golfers)
    .where(and(eq(golfers.gameId, game.id), eq(golfers.id, input.golferId)))
    .limit(1);
  if (!golfer) throw new Error('Golfer not part of this game');
  if (allPicks.some((p) => p.golferId === input.golferId)) {
    throw new Error('That golfer is already taken');
  }

  // Insert pick + maybe lock participant.
  try {
    await db.insert(picks).values({
      participantId: participant.id,
      golferId: input.golferId,
    });
  } catch (error) {
    logError(error, {
      subsystem: 'games',
      operation: 'pick_one_golfer',
      extra: { participantId: participant.id, golferId: input.golferId },
    });
    throw error;
  }

  const myPickCount =
    allPicks.filter((p) => p.participantId === participant.id).length + 1;
  const isComplete = myPickCount >= k;
  if (isComplete) {
    await db
      .update(participants)
      .set({ picksLocked: 1 })
      .where(eq(participants.id, participant.id));
  }
  return { pickCount: myPickCount, isComplete };
}

export async function getGameByCode(code: string) {
  const [game] = await db
    .select()
    .from(games)
    .where(eq(games.code, normalizeGameCode(code)))
    .limit(1);
  return game ?? null;
}

/**
 * Look up a participant by id and confirm the caller is allowed to act on
 * their behalf. Allowed if:
 *   - the participant's `user_id` matches the caller (picking for self), OR
 *   - the caller is the game creator AND the participant has `user_id IS NULL`
 *     (picking for a manually-added player).
 */
export async function loadActableParticipant(input: {
  participantId: number;
  callerUserId: string;
}): Promise<{
  participant: typeof participants.$inferSelect;
  game: typeof games.$inferSelect;
}> {
  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.id, input.participantId))
    .limit(1);
  if (!participant) throw new Error('Participant not found');

  const [game] = await db
    .select()
    .from(games)
    .where(eq(games.id, participant.gameId))
    .limit(1);
  if (!game) throw new Error('Game not found');

  const isSelf = participant.userId === input.callerUserId;
  const isCreatorActingForManual =
    participant.userId === null && game.createdByUserId === input.callerUserId;
  if (!isSelf && !isCreatorActingForManual) {
    throw new Error("You can't pick for this player");
  }
  return { participant, game };
}
