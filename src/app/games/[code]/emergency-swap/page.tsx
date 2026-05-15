import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { golfers as golfersTable, picks } from '@/db/schema';
import { getGameByCode } from '@/lib/games';
import { getParticipantForGame } from '@/lib/auth';
import { getPendingSwap } from '@/lib/emergency-swaps';
import { EmergencySwapForm } from './emergency-swap-form';

export const dynamic = 'force-dynamic';

export default async function EmergencySwapPage(
  props: PageProps<'/games/[code]/emergency-swap'>,
) {
  const { code } = await props.params;
  const game = await getGameByCode(code);
  if (!game) notFound();
  if (game.status === 'post') redirect(`/games/${game.code}`);

  const { userId } = await auth();
  if (!userId) redirect(`/games/${game.code}/join`);

  const me = await getParticipantForGame(game.id);
  if (!me) redirect(`/games/${game.code}/join`);

  const pending = await getPendingSwap(game.id);

  // Active picks the participant could still drop.
  const myActivePicks = await db
    .select({
      pickId: picks.id,
      golferId: picks.golferId,
      name: golfersTable.name,
      position: golfersTable.position,
      scoreToPar: golfersTable.scoreToPar,
    })
    .from(picks)
    .innerJoin(golfersTable, eq(picks.golferId, golfersTable.id))
    .where(and(eq(picks.participantId, me.id), eq(picks.endRound, 99)));

  // Full field for the picker — exclude golfers already on this
  // participant's roster (would be a no-op or violate uniqueness). Show
  // cut golfers grayed because they might still be the *right* misclick
  // target ("oh god I picked the wrong Fitzpatrick before he missed cut").
  const myGolferIds = new Set(myActivePicks.map((p) => p.golferId));
  const field = await db
    .select({
      id: golfersTable.id,
      name: golfersTable.name,
      country: golfersTable.country,
      position: golfersTable.position,
      scoreToPar: golfersTable.scoreToPar,
      missedCut: golfersTable.missedCut,
    })
    .from(golfersTable)
    .where(eq(golfersTable.gameId, game.id));
  const choices = field
    .filter((g) => !myGolferIds.has(g.id))
    .map((g) => ({
      id: g.id,
      name: g.name,
      country: g.country,
      position: g.position,
      scoreToPar: g.scoreToPar,
      missedCut: g.missedCut === 1,
    }));

  return (
    <main className="min-h-screen bg-cream dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href={`/games/${game.code}`}
          className="text-sm text-fairway hover:underline"
        >
          ← Back to pool
        </Link>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-fairway-deep dark:text-fairway-light">
          {game.tournamentName}
        </p>
        <h1 className="mt-1 font-display text-4xl font-black tracking-tight">
          Emergency pick swap
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          For honest misclicks — &ldquo;I meant Matt Fitzpatrick, not Alex&rdquo;.
          Every signed-in player in the pool has to approve. Doesn&apos;t
          burn your Day-1 or Day-2 sub.
        </p>
        {pending ? (
          <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Another swap proposal is already open in this pool. Wait for it
            to resolve (or cancel it from the pool page) before opening a
            new one.
          </div>
        ) : (
          <EmergencySwapForm
            gameCode={game.code}
            myPicks={myActivePicks.map((p) => ({
              pickId: p.pickId,
              golferId: p.golferId,
              name: p.name,
              position: p.position,
              scoreToPar: p.scoreToPar,
            }))}
            choices={choices}
          />
        )}
      </div>
    </main>
  );
}
