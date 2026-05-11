import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGameByCode } from '@/lib/games';
import { golferTotals, participantTotals } from '@/lib/scoring';
import { getParticipantId } from '@/lib/auth';
import { db } from '@/db';
import { participants } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function GamePage(props: PageProps<'/games/[code]'>) {
  const { code } = await props.params;
  const game = await getGameByCode(code);
  if (!game) notFound();

  const [users, golfers, currentParticipantId] = await Promise.all([
    participantTotals(game.id),
    golferTotals(game.id),
    getParticipantId(),
  ]);

  let needsToPick = false;
  if (currentParticipantId) {
    const [me] = await db
      .select()
      .from(participants)
      .where(and(eq(participants.id, currentParticipantId), eq(participants.gameId, game.id)))
      .limit(1);
    if (me && me.picksLocked === 0) needsToPick = true;
  }

  return (
    <main className="min-h-screen bg-cream dark:bg-zinc-950">
      <GameHeader
        game={game}
        needsToPick={needsToPick}
        beerCount={users.reduce(
          (n, u) => n + u.picks.filter((p) => p.missedCut).length,
          0,
        )}
      />

      <div className="mx-auto max-w-4xl px-6 py-8">
        <section className="mb-10">
          <SectionHeader title="Pool leaderboard" subtitle={`${users.length} player${users.length === 1 ? '' : 's'}`} />
          {users.length === 0 ? (
            <EmptyState
              message="No one has joined yet. Share the join code to get the group in."
            />
          ) : (
            <ol className="space-y-2">
              {users.map((u, i) => (
                <ParticipantRow key={u.participantId} rank={i + 1} participant={u} />
              ))}
            </ol>
          )}
        </section>

        <section>
          <SectionHeader title="Field leaderboard" subtitle={`${golfers.length} golfers`} />
          <FieldScorecard golfers={golfers} />
        </section>
      </div>
    </main>
  );
}

function GameHeader({
  game,
  needsToPick,
  beerCount,
}: {
  game: { code: string; name: string; tournamentName: string; status: string };
  needsToPick: boolean;
  beerCount: number;
}) {
  return (
    <header className="scorecard-stripe text-white">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fairway-light/80">
              {game.tournamentName} · <StatusBadge state={game.status} />
            </p>
            <h1 className="mt-1 font-display text-4xl font-black tracking-tight">
              {game.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-fairway-light/90">
              <span>
                Join code{' '}
                <span className="ml-1 rounded-md bg-white/10 px-2 py-0.5 font-mono font-semibold tracking-[0.2em] text-white">
                  {game.code}
                </span>
              </span>
              {beerCount > 0 ? (
                <span title={`${beerCount} cut pick${beerCount === 1 ? '' : 's'}`}>
                  🍺 <span className="font-semibold">{beerCount}</span> owed
                </span>
              ) : null}
              <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                Public pool
              </span>
            </div>
          </div>
          {needsToPick ? (
            <Link
              href={`/games/${game.code}/pick`}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 font-semibold text-fairway-deep transition hover:bg-fairway-light"
            >
              Pick your golfers →
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function StatusBadge({ state }: { state: string }) {
  const label =
    state === 'in' ? 'Live' : state === 'post' ? 'Final' : 'Upcoming';
  return <span className="font-semibold">{label}</span>;
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      {subtitle ? (
        <span className="text-xs font-mono uppercase tracking-wider text-zinc-500">
          {subtitle}
        </span>
      ) : null}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/50 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/50">
      {message}
    </div>
  );
}

type ParticipantRow = {
  participantId: number;
  displayName: string;
  points: number;
  picks: Array<{ golferId: number; name: string; points: number; missedCut: boolean; position: string | null }>;
};

function ParticipantRow({ rank, participant }: { rank: number; participant: ParticipantRow }) {
  const beers = participant.picks.filter((p) => p.missedCut).length;
  return (
    <li className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition hover:border-fairway/40 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-4 px-4 py-3">
        <RankBadge rank={rank} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{participant.displayName}</p>
          {beers > 0 ? (
            <p className="text-xs text-zinc-500">
              🍺 owes {beers} beer{beers === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-black tabular-nums">
            {participant.points}
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            points
          </p>
        </div>
      </div>
      {participant.picks.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-zinc-100 bg-zinc-50/60 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/40">
          {participant.picks.map((p) => (
            <PickChip key={p.golferId} pick={p} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const style =
    rank === 1
      ? 'bg-podium text-white'
      : rank === 2
        ? 'bg-zinc-400 text-white'
        : rank === 3
          ? 'bg-sand text-white'
          : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
  return (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ${style}`}>
      {rank}
    </div>
  );
}

function PickChip({
  pick,
}: {
  pick: { name: string; points: number; missedCut: boolean; position: string | null };
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        pick.missedCut
          ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
          : 'bg-white text-zinc-800 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-700'
      }`}
    >
      <span className="font-medium">{pick.name}</span>
      {pick.position ? (
        <span className="font-mono text-[10px] text-zinc-500">{pick.position}</span>
      ) : null}
      <span
        className={`font-mono font-semibold tabular-nums ${
          pick.points > 0
            ? 'text-fairway'
            : pick.points < 0
              ? 'text-flag'
              : 'text-zinc-500'
        }`}
      >
        {pick.points >= 0 ? `+${pick.points}` : pick.points}
      </span>
      {pick.missedCut ? <span>🍺</span> : null}
    </span>
  );
}

function FieldScorecard({
  golfers,
}: {
  golfers: Array<{
    golferId: number;
    name: string;
    country: string | null;
    position: string | null;
    scoreToPar: number | null;
    missedCut: boolean;
    points: number;
  }>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="scorecard-stripe grid grid-cols-[3.5rem_1fr_4rem_4.5rem] gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white sm:grid-cols-[4rem_1fr_5rem_5rem]">
        <span>Pos</span>
        <span>Golfer</span>
        <span className="text-right">To par</span>
        <span className="text-right">Points</span>
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {golfers.map((g) => (
          <li
            key={g.golferId}
            className="grid grid-cols-[3.5rem_1fr_4rem_4.5rem] items-center gap-2 px-4 py-2 text-sm sm:grid-cols-[4rem_1fr_5rem_5rem]"
          >
            <span className="font-mono text-xs font-semibold text-zinc-500">
              {g.position ?? '—'}
            </span>
            <span className="truncate">
              {g.name}
              {g.missedCut ? <span className="ml-1">🍺</span> : null}
            </span>
            <span className="text-right">
              <ScoreToPar value={g.scoreToPar} />
            </span>
            <span
              className={`text-right font-mono font-semibold tabular-nums ${
                g.points > 0
                  ? 'text-fairway'
                  : g.points < 0
                    ? 'text-flag'
                    : 'text-zinc-500'
              }`}
            >
              {g.points}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreToPar({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-zinc-400">—</span>;
  if (value === 0)
    return <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-200">E</span>;
  if (value < 0)
    return (
      <span className="font-mono font-semibold text-flag">{value}</span>
    );
  return (
    <span className="font-mono text-zinc-700 dark:text-zinc-200">+{value}</span>
  );
}
