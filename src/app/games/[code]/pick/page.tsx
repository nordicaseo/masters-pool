import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { golfers as golfersTable, participants } from '@/db/schema';
import { getGameByCode } from '@/lib/games';
import { getParticipantId } from '@/lib/auth';
import { PickForm } from './pick-form';

export const dynamic = 'force-dynamic';

export default async function PickPage(props: PageProps<'/games/[code]/pick'>) {
  const { code } = await props.params;
  const game = await getGameByCode(code);
  if (!game) notFound();

  const participantId = await getParticipantId();
  if (!participantId) {
    redirect(`/games/${game.code}/join`);
  }

  const [me] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.id, participantId), eq(participants.gameId, game.id)))
    .limit(1);
  if (!me) {
    redirect(`/games/${game.code}/join`);
  }

  if (me.picksLocked === 1) {
    redirect(`/games/${game.code}`);
  }

  const field = await db
    .select({
      id: golfersTable.id,
      name: golfersTable.name,
      country: golfersTable.country,
      position: golfersTable.position,
      scoreToPar: golfersTable.scoreToPar,
    })
    .from(golfersTable)
    .where(eq(golfersTable.gameId, game.id));

  const sortedField = [...field].sort((a, b) => {
    const ap = a.scoreToPar ?? 999;
    const bp = b.scoreToPar ?? 999;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-zinc-900 dark:text-zinc-100">
      <header className="mb-6 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Pick {game.scoringRules.picks_per_user} golfers</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Hi {me.displayName} — once you submit, your picks are locked for the rest of the tournament.
        </p>
      </header>
      <PickForm
        gameCode={game.code}
        picksRequired={game.scoringRules.picks_per_user}
        field={sortedField}
      />
    </main>
  );
}
