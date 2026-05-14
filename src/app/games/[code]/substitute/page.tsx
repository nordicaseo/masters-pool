import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { golfers as golfersTable, picks } from '@/db/schema';
import { getGameByCode } from '@/lib/games';
import { getParticipantForGame } from '@/lib/auth';
import {
  availableGolfersForSubstitution,
  canSubstitute,
  costForPosition,
} from '@/lib/substitutions';
import { topPickCosts } from '@/db/schema';
import { SubstituteForm } from './substitute-form';

export const dynamic = 'force-dynamic';

export default async function SubstitutePage(
  props: PageProps<'/games/[code]/substitute'>,
) {
  const { code } = await props.params;
  const game = await getGameByCode(code);
  if (!game) notFound();

  const { userId } = await auth();
  if (!userId) redirect(`/games/${game.code}/join`);

  const me = await getParticipantForGame(game.id);
  if (!me) redirect(`/games/${game.code}/join`);

  const window = await canSubstitute({
    gameId: game.id,
    participantId: me.id,
  });

  if (!window) {
    return (
      <main className="min-h-screen bg-cream dark:bg-zinc-950">
        <div className="mx-auto max-w-2xl px-6 py-10">
          <Link
            href={`/games/${game.code}`}
            className="text-sm text-fairway hover:underline"
          >
            ← Back to pool
          </Link>
          <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-lg font-semibold">No substitution available</p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Substitution windows open after round 1 and round 2 finish (and
              close when the next round tees off). You may have already used
              your sub for this window, or no window is open right now.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Active picks for this participant.
  const myActivePicks = await db
    .select({
      pickId: picks.id,
      golferId: picks.golferId,
      name: golfersTable.name,
      position: golfersTable.position,
      scoreToPar: golfersTable.scoreToPar,
      missedCut: golfersTable.missedCut,
    })
    .from(picks)
    .innerJoin(golfersTable, eq(picks.golferId, golfersTable.id))
    .where(and(eq(picks.participantId, me.id), eq(picks.endRound, 99)));

  const available = await availableGolfersForSubstitution(game.id);
  const costs = topPickCosts(game.scoringRules);

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
          {game.tournamentName} · {window === 'day_1' ? 'Day 1 sub window' : 'Day 2 sub window'}
        </p>
        <h1 className="mt-1 font-display text-4xl font-black tracking-tight">
          Make a substitution
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Drop one golfer from your roster and pick a replacement from the
          available pool. Swapping in a top-5 golfer costs points (shown next
          to each row).
        </p>
        <CostLegend costs={costs} />
        <SubstituteForm
          gameCode={game.code}
          myPicks={myActivePicks.map((p) => ({
            pickId: p.pickId,
            golferId: p.golferId,
            name: p.name,
            position: p.position,
            scoreToPar: p.scoreToPar,
          }))}
          available={available.map((g) => ({
            id: g.id,
            name: g.name,
            country: g.country,
            position: g.position,
            scoreToPar: g.scoreToPar,
            cost: costForPosition(g.position, costs),
          }))}
        />
      </div>
    </main>
  );
}

function CostLegend({ costs }: { costs: number[] }) {
  const allZero = costs.every((c) => c === 0);
  if (allZero) {
    return (
      <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white/50 p-3 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40">
        No top-pick cost set for this pool — any sub is free.
      </p>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
        Top-pick cost
      </p>
      <div className="flex flex-wrap gap-2">
        {costs.map((c, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
              c < 0
                ? 'bg-flag/10 text-flag'
                : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
          >
            <span className="font-semibold">#{i + 1}</span>
            <span className="font-mono">{c === 0 ? 'free' : c}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
