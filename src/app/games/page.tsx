import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { SignInButton } from '@clerk/nextjs';
import { db } from '@/db';
import { games, participants } from '@/db/schema';

export const dynamic = 'force-dynamic';

export default async function GamesIndexPage() {
  const { userId } = await auth();
  const signedIn = Boolean(userId);

  const allPools = await db
    .select({
      code: games.code,
      name: games.name,
      tournamentName: games.tournamentName,
      status: games.status,
      createdByName: games.createdByName,
      createdAt: games.createdAt,
      participantCount: sql<number>`(select count(*) from ${participants} where ${participants.gameId} = ${games.id})::int`,
    })
    .from(games)
    .orderBy(desc(games.createdAt));

  // Mark which pools the current user is already in.
  let mySet = new Set<string>();
  if (userId) {
    const rows = await db
      .select({ code: games.code })
      .from(participants)
      .innerJoin(games, eq(participants.gameId, games.id))
      .where(eq(participants.userId, userId));
    mySet = new Set(rows.map((r) => r.code));
  }

  const live = allPools.filter((p) => p.status === 'in');
  const upcoming = allPools.filter((p) => p.status === 'pre');
  const finished = allPools.filter((p) => p.status === 'post');

  return (
    <main className="fairway-bg min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-black tracking-tight">
              Pools
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Browse every pool. Click one to view its leaderboard, or sign in
              and join with the code.
            </p>
          </div>
          {signedIn ? (
            <Link
              href="/games/new"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-fairway px-5 font-semibold text-white shadow-sm transition hover:bg-fairway-deep"
            >
              Create a pool →
            </Link>
          ) : (
            <SignInButton mode="modal">
              <button className="inline-flex h-11 items-center gap-2 rounded-full bg-fairway-deep px-5 font-semibold text-white shadow-sm transition hover:bg-fairway">
                Sign in to create
              </button>
            </SignInButton>
          )}
        </header>

        {allPools.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-10">
            {live.length > 0 ? (
              <Group title="Live" pools={live} mySet={mySet} />
            ) : null}
            {upcoming.length > 0 ? (
              <Group title="Upcoming" pools={upcoming} mySet={mySet} />
            ) : null}
            {finished.length > 0 ? (
              <Group title="Finished" pools={finished} mySet={mySet} dimmed />
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}

type Pool = {
  code: string;
  name: string;
  tournamentName: string;
  status: string;
  createdByName: string;
  participantCount: number;
};

function Group({
  title,
  pools,
  mySet,
  dimmed = false,
}: {
  title: string;
  pools: Pool[];
  mySet: Set<string>;
  dimmed?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-3 font-display text-xl font-bold">
        {title}
        <span className="ml-2 text-xs font-mono uppercase tracking-wider text-zinc-500">
          {pools.length}
        </span>
      </h2>
      <ul className={`grid gap-2 sm:grid-cols-2 ${dimmed ? 'opacity-80' : ''}`}>
        {pools.map((p) => (
          <li key={p.code}>
            <PoolCard pool={p} mine={mySet.has(p.code)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PoolCard({ pool, mine }: { pool: Pool; mine: boolean }) {
  return (
    <Link
      href={`/games/${pool.code}`}
      className="block rounded-2xl border border-fairway-deep/15 bg-white p-4 shadow-sm transition hover:border-fairway hover:bg-fairway-light/40 dark:border-fairway-light/20 dark:bg-zinc-900 dark:hover:bg-fairway-deep/30"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fairway-deep dark:text-fairway-light">
        {pool.tournamentName}
      </p>
      <p className="mt-0.5 truncate font-display text-lg font-bold">{pool.name}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        <StatusPill state={pool.status} />
        {mine ? (
          <span className="rounded-full bg-fairway-light px-2 py-0.5 font-semibold text-fairway-deep dark:bg-fairway-deep dark:text-fairway-light">
            You&apos;re in
          </span>
        ) : null}
        <span>
          {pool.participantCount} player
          {pool.participantCount === 1 ? '' : 's'}
        </span>
        <span className="text-zinc-400">·</span>
        <span>by {pool.createdByName}</span>
        <span className="ml-auto font-mono text-zinc-500">{pool.code}</span>
      </div>
    </Link>
  );
}

function StatusPill({ state }: { state: string }) {
  const label = state === 'in' ? 'Live' : state === 'post' ? 'Final' : 'Upcoming';
  const cls =
    state === 'in'
      ? 'bg-flag text-white'
      : state === 'post'
        ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
        : 'bg-fairway-light text-fairway-deep dark:bg-fairway-deep dark:text-fairway-light';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/50 p-10 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-fairway-light text-2xl dark:bg-fairway-deep/40">
        ⛳
      </div>
      <p className="font-medium">No pools yet.</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">
        Be the first to start one — pick a tournament, set the scoring, share
        the code.
      </p>
    </div>
  );
}
