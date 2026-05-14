import { auth } from '@clerk/nextjs/server';
import { cancelProposal } from '@/lib/rule-changes';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  context: RouteContext<'/api/games/[code]/rule-proposals/[id]/cancel'>,
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'sign in required' }, { status: 401 });
  }

  const { id } = await context.params;
  const proposalId = Number(id);
  if (!Number.isInteger(proposalId) || proposalId <= 0) {
    return Response.json({ error: 'invalid proposal id' }, { status: 400 });
  }

  try {
    await cancelProposal({ proposalId, callerUserId: userId });
    return Response.json({ ok: true });
  } catch (error) {
    logError(error, {
      subsystem: 'api',
      operation: 'cancel_proposal',
      extra: { userId, proposalId },
    });
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'failed to cancel',
      },
      { status: 400 },
    );
  }
}
