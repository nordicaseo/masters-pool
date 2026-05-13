import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { games } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { normalizeGameCode } from '@/lib/code';
import { deleteGame } from '@/lib/games';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  context: RouteContext<'/api/games/[code]'>,
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'sign in required' }, { status: 401 });
  }

  const { code } = await context.params;
  const normalized = normalizeGameCode(code);
  const [game] = await db
    .select({ id: games.id, createdByUserId: games.createdByUserId })
    .from(games)
    .where(eq(games.code, normalized))
    .limit(1);
  if (!game) {
    return Response.json({ error: 'pool not found' }, { status: 404 });
  }
  if (game.createdByUserId !== userId) {
    return Response.json(
      { error: 'only the pool creator can delete this pool' },
      { status: 403 },
    );
  }

  try {
    await deleteGame({ gameId: game.id, callerUserId: userId });
    return Response.json({ ok: true });
  } catch (error) {
    logError(error, {
      subsystem: 'api',
      operation: 'delete_game',
      extra: { userId, code: normalized },
    });
    return Response.json(
      { error: error instanceof Error ? error.message : 'failed to delete pool' },
      { status: 500 },
    );
  }
}
