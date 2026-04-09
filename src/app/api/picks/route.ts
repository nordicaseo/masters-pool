import { submitPicks } from '@/lib/games';
import { getParticipantId } from '@/lib/auth';
import { submitPicksSchema } from '@/lib/validation';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const participantId = await getParticipantId();
  if (!participantId) {
    return Response.json({ error: 'not joined to a game' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = submitPicksSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await submitPicks({ participantId, golferIds: parsed.data.golferIds });
    return Response.json({ ok: true });
  } catch (error) {
    logError(error, {
      subsystem: 'api',
      operation: 'submit_picks',
      extra: { participantId, golferIds: parsed.data.golferIds },
    });
    return Response.json(
      { error: error instanceof Error ? error.message : 'failed to submit picks' },
      { status: 400 },
    );
  }
}
