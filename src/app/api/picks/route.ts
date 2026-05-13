import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { games, participants } from '@/db/schema';
import { loadActableParticipant, pickOneGolfer, submitPicks } from '@/lib/games';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.union([
  // Free-mode: submit all K picks at once, lock the participant.
  z.object({
    gameCode: z.string().min(4).max(10),
    golferIds: z.array(z.number().int().positive()),
    // Optional override — host can pick for a manually-added participant.
    participantId: z.number().int().positive().optional(),
  }),
  // Snake-mode: one golfer at a time, must be this player's turn.
  z.object({
    gameCode: z.string().min(4).max(10),
    golferId: z.number().int().positive(),
    participantId: z.number().int().positive().optional(),
  }),
]);

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'sign in required' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  // Resolve participant. If the body includes participantId (manual-roster
  // case), use that and check ownership; otherwise look up the caller's own
  // row in this game.
  const gameCode = parsed.data.gameCode.toUpperCase();
  let participantId: number;
  if (parsed.data.participantId) {
    try {
      const { participant, game } = await loadActableParticipant({
        participantId: parsed.data.participantId,
        callerUserId: userId,
      });
      if (game.code !== gameCode) {
        return Response.json({ error: 'gameCode mismatch' }, { status: 400 });
      }
      participantId = participant.id;
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'forbidden' },
        { status: 403 },
      );
    }
  } else {
    const [row] = await db
      .select({ id: participants.id })
      .from(participants)
      .innerJoin(games, eq(participants.gameId, games.id))
      .where(and(eq(participants.userId, userId), eq(games.code, gameCode)))
      .limit(1);
    if (!row) {
      return Response.json({ error: 'not joined to this pool' }, { status: 400 });
    }
    participantId = row.id;
  }

  try {
    if ('golferIds' in parsed.data) {
      await submitPicks({ participantId, golferIds: parsed.data.golferIds });
      return Response.json({ ok: true });
    }
    const result = await pickOneGolfer({
      participantId,
      golferId: parsed.data.golferId,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logError(error, {
      subsystem: 'api',
      operation: 'submit_picks',
      extra: { userId, participantId, body },
    });
    return Response.json(
      { error: error instanceof Error ? error.message : 'failed to submit picks' },
      { status: 400 },
    );
  }
}
