import { headers } from 'next/headers';
import { ne } from 'drizzle-orm';
import { db } from '@/db';
import { games } from '@/db/schema';
import { syncGame } from '@/lib/scoring';
import { logError, logInfo } from '@/lib/log';

/**
 * Vercel Cron entrypoint. Configured in vercel.json to run every 5 minutes.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. We verify
 * that header matches the env var. Manual triggering with the same header
 * is supported for debugging.
 *
 * For each game whose tournament status is not "post" (i.e. still upcoming
 * or live) we call `syncGame`. Errors on individual games are logged but
 * do not abort the whole run.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const h = await headers();
  const auth = h.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (auth !== `Bearer ${expected}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const active = await db.select().from(games).where(ne(games.status, 'post'));

  const results: Array<{ gameId: number; ok: boolean; updated?: number; events?: number; error?: string }> = [];
  for (const g of active) {
    try {
      const r = await syncGame(g.id);
      results.push({ gameId: g.id, ok: true, updated: r.updated, events: r.events });
    } catch (error) {
      logError(error, {
        subsystem: 'cron',
        operation: 'sync_game',
        extra: { gameId: g.id, espnEventId: g.espnEventId },
      });
      results.push({
        gameId: g.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logInfo('cron tick', {
    subsystem: 'cron',
    operation: 'refresh_scores',
    extra: { games: active.length, results },
  });

  return Response.json({ ok: true, count: active.length, results });
}
