import { auth, currentUser } from '@clerk/nextjs/server';
import { createGameWithField } from '@/lib/games';
import { createGameSchema } from '@/lib/validation';
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

  const parsed = createGameSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    // Fall back to the Clerk profile name if the form didn't supply one.
    let createdByName = parsed.data.createdByName.trim();
    if (!createdByName) {
      const u = await currentUser();
      createdByName =
        u?.firstName ?? u?.username ?? u?.emailAddresses?.[0]?.emailAddress?.split('@')[0] ?? 'Player';
    }
    // Strip empty/whitespace names from the manual roster.
    const manualPlayerNames = parsed.data.manualPlayerNames
      ?.map((n) => n.trim())
      .filter(Boolean);
    const { gameId, code } = await createGameWithField({
      ...parsed.data,
      manualPlayerNames,
      createdByName,
      createdByUserId: userId,
    });
    return Response.json({ gameId, code });
  } catch (error) {
    logError(error, {
      subsystem: 'api',
      operation: 'create_game',
      extra: { userId, espnEventId: parsed.data.espnEventId },
    });
    return Response.json(
      { error: error instanceof Error ? error.message : 'failed to create game' },
      { status: 500 },
    );
  }
}
