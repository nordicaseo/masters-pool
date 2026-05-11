import { notFound } from 'next/navigation';
import { getGameByCode } from '@/lib/games';
import { JoinNamedForm } from './join-named-form';

export const dynamic = 'force-dynamic';

export default async function JoinPage(props: PageProps<'/games/[code]/join'>) {
  const { code } = await props.params;
  const game = await getGameByCode(code);
  if (!game) notFound();

  return (
    <main className="fairway-bg min-h-screen">
      <div className="mx-auto max-w-md px-6 py-16">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fairway-deep dark:text-fairway-light">
          {game.tournamentName}
        </p>
        <h1 className="mt-1 font-display text-4xl font-black tracking-tight">
          {game.name}
        </h1>
        <p className="mt-2 mb-8 text-sm text-zinc-600 dark:text-zinc-400">
          Drop your name to claim a spot, then lock in your 3 picks.
        </p>
        <JoinNamedForm code={game.code} />
      </div>
    </main>
  );
}
