import { auth } from '@clerk/nextjs/server';
import { voteOnSwapProposal } from '@/lib/emergency-swaps';
import { voteOnProposalSchema } from '@/lib/validation';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: RouteContext<'/api/games/[code]/emergency-swaps/[id]/votes'>,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = voteOnProposalSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await voteOnSwapProposal({
      proposalId,
      callerUserId: userId,
      vote: parsed.data.vote,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logError(error, {
      subsystem: 'api',
      operation: 'vote_emergency_swap',
      extra: { userId, proposalId },
    });
    return Response.json(
      { error: error instanceof Error ? error.message : 'failed to vote' },
      { status: 400 },
    );
  }
}
