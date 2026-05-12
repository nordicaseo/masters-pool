import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { games, participants } from '@/db/schema';
import { submitPicks } from '@/lib/games';
import { submitPicksSchema } from '@/lib/validation';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = submitPicksSchema.extend({
  gameCode: z.string().min(4).max(10),
});

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

  // Resolve the participant by (userId, gameCode).
  const [row] = await db
    .select({ p: participants })
    .from(participants)
    .innerJoin(games, eq(participants.gameId, games.id))
    .where(
      and(
        eq(participants.userId, userId),
        eq(games.code, parsed.data.gameCode.toUpperCase()),
      ),
    )
    .limit(1);
  if (!row) {
    return Response.json({ error: 'not joined to this pool' }, { status: 400 });
  }

  try {
    await submitPicks({ participantId: row.p.id, golferIds: parsed.data.golferIds });
    return Response.json({ ok: true });
  } catch (error) {
    logError(error, {
      subsystem: 'api',
      operation: 'submit_picks',
      extra: { userId, participantId: row.p.id, golferIds: parsed.data.golferIds },
    });
    return Response.json(
      { error: error instanceof Error ? error.message : 'failed to submit picks' },
      { status: 400 },
    );
  }
}
