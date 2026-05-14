import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { games, participants } from '@/db/schema';
import { normalizeGameCode } from '@/lib/code';
import { loadActableParticipant } from '@/lib/games';
import { performSubstitution } from '@/lib/substitutions';
import { substitutionSchema } from '@/lib/validation';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: RouteContext<'/api/games/[code]/substitutions'>,
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'sign in required' }, { status: 401 });
  }

  const { code } = await context.params;
  const normalized = normalizeGameCode(code);
  const [game] = await db
    .select()
    .from(games)
    .where(eq(games.code, normalized))
    .limit(1);
  if (!game) {
    return Response.json({ error: 'pool not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = substitutionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Resolve participant — caller's own, or a manual one (creator only).
  let participantId: number;
  if (parsed.data.participantId) {
    try {
      const { participant, game: targetGame } = await loadActableParticipant({
        participantId: parsed.data.participantId,
        callerUserId: userId,
      });
      if (targetGame.id !== game.id) {
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
      .where(
        and(eq(participants.userId, userId), eq(participants.gameId, game.id)),
      )
      .limit(1);
    if (!row) {
      return Response.json(
        { error: 'not joined to this pool' },
        { status: 400 },
      );
    }
    participantId = row.id;
  }

  try {
    const result = await performSubstitution({
      gameId: game.id,
      participantId,
      droppedPickId: parsed.data.droppedPickId,
      newGolferId: parsed.data.newGolferId,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logError(error, {
      subsystem: 'api',
      operation: 'perform_substitution',
      extra: { userId, participantId, gameCode: normalized },
    });
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'failed to substitute',
      },
      { status: 400 },
    );
  }
}
