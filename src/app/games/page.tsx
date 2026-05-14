import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { SignInButton } from '@clerk/nextjs';
import { db } from '@/db';
import {
  games,
  participants,
  type StakeItems,
  type RosterMode,
  type DraftMode,
} from '@/db/schema';
import { canSubstitute, type SwapWindow } from '@/lib/substitutions';

export const dynamic = 'force-dynamic';

type PoolRow = {
  id: number;
  code: string;
  name: string;
  tournamentName: string;
  status: string;
  createdByName: string;
  stakes: string | null;
  stakeItems: StakeItems | null;
  rosterMode: RosterMode;
  draftMode: DraftMode;
  maxPlayers: number | null;
  participantCount: number;
};

export default async function GamesIndexPage() {
  const { userId } = await auth();
  const signedIn = Boolean(userId);

  const allPools = await db
    .select({
      id: games.id,
      code: games.code,
      name: games.name,
      tournamentName: games.tournamentName,
      status: games.status,
      createdByName: games.createdByName,
      stakes: games.stakes,
      stakeItems: games.stakeItems,
      rosterMode: games.rosterMode,
      draftMode: games.draftMode,
      maxPlayers: games.maxPlayers,
      participantCount: sql<number>`(select count(*) from ${participants} where ${participants.gameId} = ${games.id})::int`,
    })
    .from(games)
    .orderBy(desc(games.createdAt));

  // My participant rows in the pools I'm in. Used to flag "you're in" and
  // to compute live sub-window status.
  type MyMembership = { participantId: number; gameId: number };
  let myByGameId = new Map<number, MyMembership>();
  if (userId) {
    const rows = await db
      .select({
        participantId: participants.id,
        gameId: participants.gameId,
      })
      .from(participants)
      .where(eq(participants.userId, userId));
    myByGameId = new Map(rows.map((r) => [r.gameId, r]));
  }

  // Substitution status for every pool I'm in, in parallel. Small N
  // (handful of pools per user); each call reads a few hundred scoring
  // events at worst.
  const subEntries = await Promise.all(
    Array.from(myByGameId.values()).map(async (m) => {
      const w = await canSubstitute({
        gameId: m.gameId,
        participantId: m.participantId,
      });
      return [m.gameId, w] as const;
    }),
  );
  const subByGameId = new Map<number, SwapWindow>(subEntries);

  // Group the pools.
  const yourPools: PoolRow[] = [];
  const openToJoin: PoolRow[] = [];
  const browse: PoolRow[] = [];
  for (const p of allPools) {
    if (myByGameId.has(p.id)) {
      yourPools.push(p);
    } else if (isJoinable(p) && signedIn) {
      openToJoin.push(p);
    } else {
      browse.push(p);
    }
  }

  return (
    <main className="fairway-bg min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-black tracking-tight">
              Pools
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Substitutions are enabled in every pool — one swap after Day 1,
              one after Day 2.
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
            {yourPools.length > 0 ? (
              <Group
                title="Your pools"
                subtitle="You're in — click to manage picks & subs"
                pools={yourPools}
                subByGameId={subByGameId}
                showSubChip
              />
            ) : null}
            {openToJoin.length > 0 ? (
              <Group
                title="Open to join"
                subtitle="Open roster, room for more"
                pools={openToJoin}
                subByGameId={subByGameId}
                accent
              />
            ) : null}
            {browse.length > 0 ? (
              <Group
                title={signedIn ? 'Browse' : 'All pools'}
                subtitle={
                  signedIn
                    ? 'Full, finished, or manual-roster pools'
                    : 'Sign in to join a pool'
                }
                pools={browse}
                subByGameId={subByGameId}
                dimmed={!signedIn ? false : true}
              />
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * Whether a pool is currently joinable by a signed-in non-participant.
 * Open roster + not finished + (free draft OR snake with room).
 */
function isJoinable(p: PoolRow): boolean {
  if (p.rosterMode !== 'open') return false;
  if (p.status === 'post') return false;
  if (p.draftMode === 'snake' && p.maxPlayers !== null) {
    return p.participantCount < p.maxPlayers;
  }
  return true;
}

function Group({
  title,
  subtitle,
  pools,
  subByGameId,
  showSubChip = false,
  accent = false,
  dimmed = false,
}: {
  title: string;
  subtitle?: string;
  pools: PoolRow[];
  subByGameId: Map<number, SwapWindow>;
  showSubChip?: boolean;
  accent?: boolean;
  dimmed?: boolean;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="font-display text-xl font-bold">
            {title}
            <span className="ml-2 text-xs font-mono uppercase tracking-wider text-zinc-500">
              {pools.length}
            </span>
          </h2>
          {subtitle ? (
            <p className="text-xs text-zinc-500">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <ul className={`grid gap-2 sm:grid-cols-2 ${dimmed ? 'opacity-80' : ''}`}>
        {pools.map((p) => (
          <li key={p.code}>
            <PoolCard
              pool={p}
              mine={showSubChip}
              accent={accent}
              subWindow={subByGameId.get(p.id) ?? null}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PoolCard({
  pool,
  mine,
  accent,
  subWindow,
}: {
  pool: PoolRow;
  mine: boolean;
  accent: boolean;
  subWindow: SwapWindow;
}) {
  const stakeChips = stakeChipsFor(pool);
  const capacity = capacityFor(pool);
  return (
    <Link
      href={`/games/${pool.code}`}
      className={`block rounded-2xl border bg-white p-4 shadow-sm transition dark:bg-zinc-900 ${
        accent
          ? 'border-fairway/40 hover:border-fairway hover:bg-fairway-light/40 dark:border-fairway-light/30'
          : 'border-fairway-deep/15 hover:border-fairway hover:bg-fairway-light/40 dark:border-fairway-light/20 dark:hover:bg-fairway-deep/30'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fairway-deep dark:text-fairway-light">
            {pool.tournamentName}
          </p>
          <p className="mt-0.5 truncate font-display text-lg font-bold">
            {pool.name}
          </p>
        </div>
        <StatusPill state={pool.status} />
      </div>

      {stakeChips.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {stakeChips.map((c, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-fairway-light/60 px-2 py-0.5 text-[11px] font-medium text-fairway-deep dark:bg-fairway-deep/40 dark:text-fairway-light"
            >
              <span aria-hidden>{c.emoji}</span>
              <span>{c.label}</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        {mine ? (
          <span className="rounded-full bg-fairway-light px-2 py-0.5 font-semibold text-fairway-deep dark:bg-fairway-deep dark:text-fairway-light">
            You&apos;re in
          </span>
        ) : null}
        {mine && subWindow ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            🔄 {subWindow === 'day_1' ? 'Day-1' : 'Day-2'} sub open
          </span>
        ) : null}
        <span>{capacity}</span>
        <span className="text-zinc-400">·</span>
        <span>by {pool.createdByName}</span>
        <span className="ml-auto font-mono text-zinc-500">{pool.code}</span>
      </div>
    </Link>
  );
}

type StakeChip = { emoji: string; label: string };

function stakeChipsFor(pool: PoolRow): StakeChip[] {
  const chips: StakeChip[] = [];
  const items = pool.stakeItems;
  if (items) {
    if ((items.beers ?? 0) > 0) {
      chips.push({
        emoji: '🍺',
        label: `${items.beers}`,
      });
    }
    if ((items.hotDogs ?? 0) > 0) {
      chips.push({
        emoji: '🌭',
        label: `${items.hotDogs}`,
      });
    }
    if ((items.hotSoup ?? 0) > 0) {
      chips.push({
        emoji: '🥣',
        label: `${items.hotSoup}`,
      });
    }
    if (items.other?.trim()) {
      const truncated =
        items.other.length > 24
          ? `${items.other.slice(0, 24)}…`
          : items.other;
      chips.push({ emoji: '🎁', label: truncated });
    }
  } else if (pool.stakes) {
    // Legacy free-text fallback — single chip.
    const truncated =
      pool.stakes.length > 36 ? `${pool.stakes.slice(0, 36)}…` : pool.stakes;
    chips.push({ emoji: '🎁', label: truncated });
  }
  return chips;
}

function capacityFor(p: PoolRow): string {
  if (p.draftMode === 'snake' && p.maxPlayers !== null) {
    return `${p.participantCount}/${p.maxPlayers} players`;
  }
  return `${p.participantCount} player${p.participantCount === 1 ? '' : 's'}`;
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
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}
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
