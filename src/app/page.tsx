import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { games, participants } from '@/db/schema';
import { JoinForm } from './_components/join-form';
import { SignInButton } from '@clerk/nextjs';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { userId } = await auth();
  const signedIn = Boolean(userId);

  type Mine = {
    code: string;
    name: string;
    tournamentName: string;
    status: string;
    picksLocked: number;
  };
  let myPools: Mine[] = [];
  if (userId) {
    myPools = await db
      .select({
        code: games.code,
        name: games.name,
        tournamentName: games.tournamentName,
        status: games.status,
        picksLocked: participants.picksLocked,
      })
      .from(participants)
      .innerJoin(games, eq(participants.gameId, games.id))
      .where(eq(participants.userId, userId))
      .orderBy(desc(games.createdAt));
  }

  return (
    <main className="fairway-bg flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-14 px-6 py-12 sm:py-20">
        <header className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-fairway-deep px-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white">
              <FlagIcon className="h-3 w-3" />
              Fantasy Golf Pool
            </span>
          </div>
          <h1 className="font-display text-5xl font-black leading-[1.05] tracking-tight sm:text-6xl">
            Pick three.
            <br />
            <span className="italic text-fairway">Win beers.</span>
          </h1>
          <p className="max-w-xl text-base text-zinc-700 dark:text-zinc-300">
            A tiny fantasy pool for your friend group. Pick 3 golfers, score
            birdies and eagles, owe a beer for every cut. Live scores from ESPN.
          </p>
        </header>

        {signedIn && myPools.length > 0 ? (
          <section className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-bold">Your pools</h2>
              <Link
                href="/games"
                className="text-xs font-mono uppercase tracking-wider text-zinc-500 hover:text-fairway"
              >
                Browse all →
              </Link>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {myPools.map((p) => (
                <li key={p.code}>
                  <Link
                    href={`/games/${p.code}`}
                    className="block rounded-2xl border border-fairway-deep/15 bg-white p-4 shadow-sm transition hover:border-fairway hover:bg-fairway-light/40 dark:border-fairway-light/20 dark:bg-zinc-900 dark:hover:bg-fairway-deep/30"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fairway-deep dark:text-fairway-light">
                      {p.tournamentName}
                    </p>
                    <p className="mt-0.5 truncate font-display text-lg font-bold">
                      {p.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <StatusPill state={p.status} />
                      {p.picksLocked === 0 ? (
                        <span className="rounded-full bg-podium-soft px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
                          Pick your golfers
                        </span>
                      ) : null}
                      <span className="font-mono text-zinc-500">{p.code}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-bold">Join a pool</h2>
            <span className="text-xs font-mono uppercase tracking-wider text-zinc-500">
              with a 6-char code
            </span>
          </div>
          {signedIn ? (
            <JoinForm />
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/70 p-5 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300">
              Sign in to join a pool — your picks and pools are saved to your
              account so they show up on every device.{' '}
              <SignInButton mode="modal">
                <button className="font-semibold text-fairway underline-offset-2 hover:underline">
                  Sign in
                </button>
              </SignInButton>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-2xl font-bold">Or start a new one</h2>
          {signedIn ? (
            <Link
              href="/games/new"
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-fairway px-6 font-semibold text-white shadow-sm transition hover:bg-fairway-deep"
            >
              <FlagIcon className="h-4 w-4" />
              Create a pool
              <span className="transition group-hover:translate-x-0.5">→</span>
            </Link>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Sign in to create a pool.
            </p>
          )}
        </section>

        <ScorecardFooter />
      </div>
    </main>
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

function ScorecardFooter() {
  const cells = [
    { label: 'Birdie', value: '+1' },
    { label: 'Eagle', value: '+2' },
    { label: 'Albatross', value: '+5' },
    { label: 'Hole in one', value: '+7' },
    { label: 'Bogey', value: '−1' },
    { label: '1st place', value: '+20' },
    { label: '2nd place', value: '+10' },
    { label: 'Cut', value: '🍺' },
  ];
  return (
    <footer className="mt-auto overflow-hidden rounded-2xl border border-fairway-deep/15 bg-white shadow-sm dark:border-fairway-light/20 dark:bg-zinc-900">
      <div className="scorecard-stripe px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white">
        Default scorecard
      </div>
      <ul className="grid grid-cols-4 divide-x divide-y divide-zinc-200 dark:divide-zinc-800 sm:grid-cols-8 sm:divide-y-0">
        {cells.map((c) => (
          <li
            key={c.label}
            className="flex flex-col items-center gap-0.5 px-2 py-2 text-center"
          >
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              {c.label}
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {c.value}
            </span>
          </li>
        ))}
      </ul>
    </footer>
  );
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 22V4" />
      <path d="M4 4h12l-2.5 4L16 12H4" fill="currentColor" />
    </svg>
  );
}
