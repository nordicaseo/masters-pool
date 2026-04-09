import { notFound } from 'next/navigation';
import { getGameByCode } from '@/lib/games';
import { JoinNamedForm } from './join-named-form';

export const dynamic = 'force-dynamic';

export default async function JoinPage(props: PageProps<'/games/[code]/join'>) {
  const { code } = await props.params;
  const game = await getGameByCode(code);
  if (!game) notFound();

  return (
    <main className="mx-auto max-w-md px-6 py-16 text-zinc-900 dark:text-zinc-100">
      <h1 className="mb-2 text-3xl font-bold">{game.name}</h1>
      <p className="mb-8 text-sm text-zinc-600 dark:text-zinc-400">{game.tournamentName}</p>
      <JoinNamedForm code={game.code} />
    </main>
  );
}
