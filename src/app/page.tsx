import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { games, participants } from '@/db/schema';
import { fetchSeasonSchedule, type ScheduledTournament } from '@/lib/espn';
import { getHomepageStats, type HomepageStats } from '@/lib/homepage';
import { relinkLegacyAccount } from '@/lib/auth';
import { logError } from '@/lib/log';
import { JoinForm } from './_components/join-form';
import { SignInButton } from '@clerk/nextjs';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { userId } = await auth();
  const signedIn = Boolean(userId);

  // Account-preservation: a returning user from the old Clerk instance
  // reclaims their pools on first load (no-op once everyone has returned).
  // Must run before loadMyPools so the re-linked rows show up immediately.
  if (userId) await relinkLegacyAccount(userId);

  // Three things in parallel — myPools (cheap), schedule (cached), stats (cheap).
  const [myPools, schedule, stats] = await Promise.all([
    loadMyPools(userId),
    safeFetchSchedule(),
    safeStats(),
  ]);

  const liveEvent = schedule.find((t) => t.state === 'in') ?? null;
  const upcoming = filterUpcoming(schedule);

  return (
    <main className="fairway-bg flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-6 py-12 sm:py-16">
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
            birdies and eagles, owe a beer for every cut. Live scores from
            ESPN. Lunch wagers strongly encouraged.
          </p>
        </header>

        {liveEvent ? <LiveTournament event={liveEvent} /> : null}

        <WeekendStats stats={stats} hasLive={Boolean(liveEvent)} />

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

        {upcoming.length > 0 ? <UpcomingTournaments events={upcoming} /> : null}

        <ScorecardFooter />
      </div>
    </main>
  );
}

/**
 * Pick the next ≤4 "pre" events starting within the next 6 weeks. Pulled
 * out of the page component so the request-time `Date.now()` read happens
 * outside the JSX render path (which makes the React purity lint rule
 * happy on Next 16 / React 19).
 */
function filterUpcoming(
  schedule: ScheduledTournament[],
): ScheduledTournament[] {
  const now = Date.now();
  const sixWeeks = 6 * 7 * 24 * 60 * 60 * 1000;
  const oneDay = 24 * 60 * 60 * 1000;
  return schedule
    .filter((t) => {
      if (t.state !== 'pre') return false;
      const start = new Date(t.startDate).getTime();
      return start - now < sixWeeks && start > now - oneDay;
    })
    .sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    )
    .slice(0, 4);
}

// ---------- Loaders (with safe fallbacks) ----------

async function loadMyPools(userId: string | null): Promise<MyPool[]> {
  if (!userId) return [];
  return db
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

async function safeFetchSchedule(): Promise<ScheduledTournament[]> {
  try {
    const year = new Date().getUTCFullYear();
    return await fetchSeasonSchedule(year);
  } catch (err) {
    logError(err, { subsystem: 'homepage', operation: 'fetch_schedule' });
    return [];
  }
}

async function safeStats(): Promise<HomepageStats> {
  try {
    return await getHomepageStats();
  } catch (err) {
    logError(err, { subsystem: 'homepage', operation: 'fetch_stats' });
    return {
      activePools: 0,
      activePlayers: 0,
      beersOnTheLine: 0,
      stakeTotals: { beers: 0, hotDogs: 0, hotSoup: 0, other: 0 },
    };
  }
}

// ---------- Sub-components ----------

type MyPool = {
  code: string;
  name: string;
  tournamentName: string;
  status: string;
  picksLocked: number;
};

function LiveTournament({ event }: { event: ScheduledTournament }) {
  const detail = event.statusDetail ?? 'In Progress';
  const roundLabel = event.currentRound
    ? `Day ${event.currentRound} of 4`
    : null;
  return (
    <section className="overflow-hidden rounded-2xl border-2 border-fairway bg-white shadow-md dark:border-fairway-light/40 dark:bg-zinc-900">
      <div className="scorecard-stripe flex items-center justify-between px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white">
        <span className="inline-flex items-center gap-1.5">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-flag opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-flag" />
          </span>
          Live now
        </span>
        {event.isMajor ? (
          <span className="rounded-full bg-podium px-2 py-0.5 text-[9px] text-white">
            ★ Major
          </span>
        ) : null}
      </div>
      <div className="space-y-1 px-4 py-4">
        <h2 className="font-display text-2xl font-bold">{event.name}</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          {roundLabel ? (
            <span className="rounded-full bg-fairway-light px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-fairway-deep dark:bg-fairway-deep dark:text-fairway-light">
              {roundLabel}
            </span>
          ) : null}
          <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">
            {detail}
          </span>
        </div>
      </div>
    </section>
  );
}

function WeekendStats({
  stats,
  hasLive,
}: {
  stats: HomepageStats;
  hasLive: boolean;
}) {
  const { activePools, activePlayers, beersOnTheLine, stakeTotals } = stats;
  if (activePools === 0 && beersOnTheLine === 0 && stakeTotals.beers === 0) {
    return null;
  }
  const otherChips: Array<{ emoji: string; n: number; label: string }> = [];
  if (stakeTotals.other > 0) {
    otherChips.push({
      emoji: '🎁',
      n: stakeTotals.other,
      label: `bespoke wager${stakeTotals.other === 1 ? '' : 's'}`,
    });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-fairway-deep/15 bg-white shadow-sm dark:border-fairway-light/20 dark:bg-zinc-900">
      <div className="scorecard-stripe flex items-center justify-between px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white">
        <span>{hasLive ? 'This weekend' : 'On the docket'}</span>
        <span className="font-mono">🏌️</span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-zinc-100 dark:divide-zinc-800">
        <Stat
          value={stakeTotals.beers}
          label="beer wagered"
          plural="beers wagered"
          emoji="🍺"
        />
        <Stat
          value={stakeTotals.hotDogs}
          label="hot dog wagered"
          plural="hot dogs wagered"
          emoji="🌭"
        />
        <Stat
          value={stakeTotals.hotSoup}
          label="hot soup wagered"
          plural="hot soups wagered"
          emoji="🥣"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
        <span className="font-medium">
          <span className="font-mono font-semibold tabular-nums">
            {activePlayers}
          </span>{' '}
          player{activePlayers === 1 ? '' : 's'} across{' '}
          <span className="font-mono font-semibold tabular-nums">
            {activePools}
          </span>{' '}
          active pool{activePools === 1 ? '' : 's'}
        </span>
        {otherChips.map((c) => (
          <span
            key={c.emoji}
            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800"
          >
            <span>{c.emoji}</span>
            <span className="font-mono font-semibold">{c.n}</span>
            <span className="text-zinc-500">{c.label}</span>
          </span>
        ))}
      </div>
      {beersOnTheLine > 0 ? (
        <p className="border-t border-zinc-100 px-4 py-2 text-center text-[11px] italic text-zinc-500 dark:border-zinc-800">
          {pickFlavor(beersOnTheLine)}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Deterministically-ish flavor text based on the beer count — small
 * embedded joke so the page feels alive. The pool of lines is short on
 * purpose; people refreshing the home page should see roughly the same
 * one until the count changes.
 */
function pickFlavor(beerCount: number): string {
  const lines = [
    `${beerCount} cold ones earmarked for missed cuts.`,
    `${beerCount} ${beerCount === 1 ? 'beer is' : 'beers are'} doing pre-emptive pushups.`,
    `Friday cut watch: ${beerCount} ${beerCount === 1 ? 'beer' : 'beers'} loading.`,
    `Somewhere a fridge is rooting for the cut line.`,
    `${beerCount} ${beerCount === 1 ? 'IOU is' : 'IOUs are'} writing themselves.`,
  ];
  return lines[beerCount % lines.length]!;
}

function Stat({
  value,
  label,
  plural,
  emoji,
}: {
  value: number;
  label: string;
  plural: string;
  emoji: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-2 py-4 text-center">
      <span aria-hidden className="text-2xl">
        {emoji}
      </span>
      <span className="font-mono text-3xl font-black tabular-nums">{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {value === 1 ? label : plural}
      </span>
    </div>
  );
}

function UpcomingTournaments({ events }: { events: ScheduledTournament[] }) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-bold">Coming up</h2>
        <span className="text-xs font-mono uppercase tracking-wider text-zinc-500">
          Next 6 weeks
        </span>
      </div>
      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-fairway-deep/15 bg-white shadow-sm dark:divide-zinc-800 dark:border-fairway-light/20 dark:bg-zinc-900">
        {events.map((e) => (
          <li
            key={e.espnEventId}
            className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm"
          >
            <span className="w-16 font-mono text-xs uppercase tracking-wider text-zinc-500">
              {fmt.format(new Date(e.startDate))}
            </span>
            <span className="flex-1 font-medium">{e.name}</span>
            {e.isMajor ? (
              <span className="rounded-full bg-podium-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200">
                ★ Major
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
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
