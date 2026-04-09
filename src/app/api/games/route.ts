import { createGameWithField } from '@/lib/games';
import { setParticipantCookie } from '@/lib/auth';
import { createGameSchema } from '@/lib/validation';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = createGameSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { gameId, code, creatorParticipantId } = await createGameWithField(parsed.data);
    await setParticipantCookie(creatorParticipantId);
    return Response.json({ gameId, code });
  } catch (error) {
    logError(error, {
      subsystem: 'api',
      operation: 'create_game',
      extra: { espnEventId: parsed.data.espnEventId },
    });
    return Response.json(
      { error: error instanceof Error ? error.message : 'failed to create game' },
      { status: 500 },
    );
  }
}
