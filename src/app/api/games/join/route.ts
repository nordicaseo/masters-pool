import { auth } from '@clerk/nextjs/server';
import { joinGame } from '@/lib/games';
import { joinGameSchema } from '@/lib/validation';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  const parsed = joinGameSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { gameId, code } = await joinGame({ ...parsed.data, userId });
    return Response.json({ gameId, code });
  } catch (error) {
    logError(error, {
      subsystem: 'api',
      operation: 'join_game',
      extra: { userId, code: parsed.data.code },
    });
    return Response.json(
      { error: error instanceof Error ? error.message : 'failed to join game' },
      { status: 400 },
    );
  }
}
