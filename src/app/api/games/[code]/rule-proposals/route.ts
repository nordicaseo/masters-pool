import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { games } from '@/db/schema';
import { normalizeGameCode } from '@/lib/code';
import { createProposal } from '@/lib/rule-changes';
import { proposeRulesSchema } from '@/lib/validation';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: RouteContext<'/api/games/[code]/rule-proposals'>,
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'sign in required' }, { status: 401 });
  }

  const { code } = await context.params;
  const normalized = normalizeGameCode(code);
  const [game] = await db
    .select({ id: games.id })
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
  const parsed = proposeRulesSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await createProposal({
      gameId: game.id,
      proposerUserId: userId,
      afterRules: parsed.data.afterRules,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logError(error, {
      subsystem: 'api',
      operation: 'create_rule_proposal',
      extra: { userId, gameCode: normalized },
    });
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'failed to propose rules',
      },
      { status: 400 },
    );
  }
}
