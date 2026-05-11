import Link from 'next/link';
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
    <main className="min-h-screen bg-cream dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fairway-deep dark:text-fairway-light">
          {game.tournamentName}
        </p>
        <h1 className="mt-1 font-display text-4xl font-black tracking-tight">
          Pick {game.scoringRules.picks_per_user} golfers
        </h1>
        <p className="mt-2 mb-8 text-sm text-zinc-600 dark:text-zinc-400">
          Hi <span className="font-semibold">{me.displayName}</span> — once
          you submit, your picks are locked for the rest of the tournament.
        </p>
        {sortedField.length === 0 ? (
          <FieldPublishesSoon code={game.code} />
        ) : (
          <PickForm
            gameCode={game.code}
            picksRequired={game.scoringRules.picks_per_user}
            field={sortedField}
          />
        )}
      </div>
    </main>
  );
}

function FieldPublishesSoon({ code }: { code: string }) {
  return (
    <div className="rounded-2xl border border-fairway-deep/15 bg-white p-8 text-center shadow-sm dark:border-fairway-light/20 dark:bg-zinc-900">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-fairway-light text-2xl dark:bg-fairway-deep/40">
        ⛳
      </div>
      <h2 className="font-display text-2xl font-bold">Field publishes soon</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        ESPN hasn&apos;t posted the tee sheet for this tournament yet — that
        usually happens a day or two before the first round. Come back to this
        page once the field drops to lock in your picks. Your spot is saved.
      </p>
      <Link
        href={`/games/${code}`}
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-fairway px-5 font-semibold text-white shadow-sm transition hover:bg-fairway-deep"
      >
        Back to pool →
      </Link>
    </div>
  );
}
