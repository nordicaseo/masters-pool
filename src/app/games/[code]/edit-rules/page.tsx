import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getGameByCode } from '@/lib/games';
import { getPendingProposal } from '@/lib/rule-changes';
import { EditRulesForm } from './edit-rules-form';

export const dynamic = 'force-dynamic';

export default async function EditRulesPage(
  props: PageProps<'/games/[code]/edit-rules'>,
) {
  const { code } = await props.params;
  const game = await getGameByCode(code);
  if (!game) notFound();

  const { userId } = await auth();
  if (!userId) redirect(`/games/${game.code}`);
  if (game.createdByUserId !== userId) {
    redirect(`/games/${game.code}`);
  }
  if (game.status === 'post') {
    redirect(`/games/${game.code}`);
  }

  const pending = await getPendingProposal(game.id);

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
          Propose a rule change
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Changes take effect only after every signed-in participant in the
          pool approves them. Once approved, every existing per-hole event
          gets recomputed retroactively, so any &ldquo;lead&rdquo; earned
          under the old rule disappears at the same moment everyone
          else&apos;s number changes.
        </p>
        {pending ? (
          <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            A proposal is already open. Cancel it from the game page before
            making a new one.
          </div>
        ) : (
          <EditRulesForm gameCode={game.code} currentRules={game.scoringRules} />
        )}
      </div>
    </main>
  );
}
