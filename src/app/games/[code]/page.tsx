import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGameByCode } from '@/lib/games';
import { golferTotals, participantTotals } from '@/lib/scoring';
import { getParticipantForGame } from '@/lib/auth';
import { auth } from '@clerk/nextjs/server';
import { DeletePoolButton } from './delete-pool-button';
import { canSubstitute } from '@/lib/substitutions';

export const dynamic = 'force-dynamic';

export default async function GamePage(props: PageProps<'/games/[code]'>) {
  const { code } = await props.params;
  const game = await getGameByCode(code);
  if (!game) notFound();

  const [users, golfers, { userId }] = await Promise.all([
    participantTotals(game.id),
    golferTotals(game.id),
    auth(),
  ]);

  let needsToPick = false;
  let needsToJoin = false;
  let isCreator = false;
  let myParticipantId: number | null = null;
  let subWindow: 'day_1' | 'day_2' | null = null;
  if (userId) {
    isCreator = game.createdByUserId === userId;
    const me = await getParticipantForGame(game.id);
    if (me) {
      needsToPick = me.picksLocked === 0;
      myParticipantId = me.id;
      if (!needsToPick) {
        subWindow = await canSubstitute({
          gameId: game.id,
          participantId: me.id,
        });
      }
    } else if (game.rosterMode !== 'manual') {
      needsToJoin = true;
    }
  }
  // Snake-draft creators picking on behalf of manual players: always send them
  // to the pick page until the draft is complete.
  const draftIsLive =
    game.draftMode === 'snake' &&
    game.draftStartedAt !== null &&
    game.status !== 'post';
  const creatorHasMoreToPick =
    isCreator &&
    draftIsLive &&
    users.some((u) => u.picks.length < game.scoringRules.picks_per_user);

  // Assign each participant a stable color from a fixed palette so we can
  // color-code their picks on the field leaderboard. Sorted by participant id
  // for stability across page renders.
  const colorByParticipant = new Map<number, ParticipantColor>();
  const sortedForColors = [...users].sort((a, b) => a.participantId - b.participantId);
  sortedForColors.forEach((u, i) => {
    colorByParticipant.set(
      u.participantId,
      PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length]!,
    );
  });

  // golferId -> participants currently holding (active picks).
  const holdersByGolfer = new Map<
    number,
    Array<{ participantId: number; displayName: string }>
  >();
  for (const u of users) {
    for (const pk of u.picks) {
      const arr = holdersByGolfer.get(pk.golferId) ?? [];
      arr.push({ participantId: u.participantId, displayName: u.displayName });
      holdersByGolfer.set(pk.golferId, arr);
    }
  }

  return (
    <main className="min-h-screen bg-cream dark:bg-zinc-950">
      <GameHeader
        game={game}
        needsToPick={needsToPick || creatorHasMoreToPick}
        needsToJoin={needsToJoin}
        beerCount={users.reduce(
          (n, u) => n + u.picks.filter((p) => p.missedCut).length,
          0,
        )}
      />

      <div className="mx-auto max-w-4xl px-6 py-8">
        {subWindow && myParticipantId !== null ? (
          <SubstitutionBanner gameCode={game.code} window={subWindow} />
        ) : null}

        <section className="mb-10">
          <SectionHeader title="Pool leaderboard" subtitle={`${users.length} player${users.length === 1 ? '' : 's'}`} />
          {users.length === 0 ? (
            <EmptyState
              message="No one has joined yet. Share the join code to get the group in."
            />
          ) : (
            <ol className="space-y-2">
              {users.map((u, i) => (
                <ParticipantRow
                  key={u.participantId}
                  rank={i + 1}
                  participant={u}
                  gameCode={game.code}
                  color={colorByParticipant.get(u.participantId) ?? null}
                  isYou={myParticipantId === u.participantId}
                />
              ))}
            </ol>
          )}
        </section>

        <section>
          <SectionHeader title="Field leaderboard" subtitle={`${golfers.length} golfers`} />
          {golfers.length === 0 ? (
            <EmptyState message="Field publishes a day or two before the tournament — check back closer to round 1." />
          ) : (
            <FieldScorecard
              gameCode={game.code}
              golfers={golfers}
              holdersByGolfer={holdersByGolfer}
              colorByParticipant={colorByParticipant}
              myParticipantId={myParticipantId}
            />
          )}
        </section>

        {isCreator ? (
          <section className="mt-12 border-t border-zinc-200 pt-6 dark:border-zinc-800">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Creator tools
            </p>
            <DeletePoolButton gameCode={game.code} gameName={game.name} />
          </section>
        ) : null}
      </div>
    </main>
  );
}

type ParticipantColor = {
  /** Solid swatch for the participant's dot/pill. */
  swatch: string;
  /** Soft background tint when YOUR row is highlighted. */
  rowTint: string;
  /** Ring used to subtly outline rows when YOUR pick is on this golfer. */
  ring: string;
};

/**
 * Fixed palette of 10 distinct hues. Class names must appear as literals
 * for Tailwind to bundle them, so the palette is enumerated explicitly.
 */
const PARTICIPANT_COLORS: ParticipantColor[] = [
  { swatch: 'bg-emerald-500', rowTint: 'bg-emerald-50/60 dark:bg-emerald-900/20', ring: 'ring-emerald-500/40' },
  { swatch: 'bg-sky-500',     rowTint: 'bg-sky-50/60 dark:bg-sky-900/20',         ring: 'ring-sky-500/40' },
  { swatch: 'bg-amber-500',   rowTint: 'bg-amber-50/60 dark:bg-amber-900/20',     ring: 'ring-amber-500/40' },
  { swatch: 'bg-rose-500',    rowTint: 'bg-rose-50/60 dark:bg-rose-900/20',       ring: 'ring-rose-500/40' },
  { swatch: 'bg-violet-500',  rowTint: 'bg-violet-50/60 dark:bg-violet-900/20',   ring: 'ring-violet-500/40' },
  { swatch: 'bg-orange-500',  rowTint: 'bg-orange-50/60 dark:bg-orange-900/20',   ring: 'ring-orange-500/40' },
  { swatch: 'bg-teal-500',    rowTint: 'bg-teal-50/60 dark:bg-teal-900/20',       ring: 'ring-teal-500/40' },
  { swatch: 'bg-fuchsia-500', rowTint: 'bg-fuchsia-50/60 dark:bg-fuchsia-900/20', ring: 'ring-fuchsia-500/40' },
  { swatch: 'bg-indigo-500',  rowTint: 'bg-indigo-50/60 dark:bg-indigo-900/20',   ring: 'ring-indigo-500/40' },
  { swatch: 'bg-lime-500',    rowTint: 'bg-lime-50/60 dark:bg-lime-900/20',       ring: 'ring-lime-500/40' },
];

function SubstitutionBanner({
  gameCode,
  window,
}: {
  gameCode: string;
  window: 'day_1' | 'day_2';
}) {
  const label = window === 'day_1' ? 'Day 1' : 'Day 2';
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-fairway/40 bg-fairway-light/60 px-4 py-3 shadow-sm dark:border-fairway-light/30 dark:bg-fairway-deep/30">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fairway-deep dark:text-fairway-light">
          {label} substitution window is open
        </p>
        <p className="text-sm text-zinc-700 dark:text-zinc-200">
          Drop one of your picks for any unheld golfer. Closes when the next round tees off.
        </p>
      </div>
      <Link
        href={`/games/${gameCode}/substitute`}
        className="inline-flex h-10 items-center gap-2 rounded-full bg-fairway px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-fairway-deep"
      >
        Make a substitution →
      </Link>
    </div>
  );
}

function GameHeader({
  game,
  needsToPick,
  needsToJoin,
  beerCount,
}: {
  game: {
    code: string;
    name: string;
    tournamentName: string;
    status: string;
    stakes: string | null;
  };
  needsToPick: boolean;
  needsToJoin: boolean;
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
            {game.stakes ? (
              <p className="mt-2 text-sm text-fairway-light/90">
                <span className="font-semibold uppercase tracking-wider text-fairway-light/70">
                  Playing for:
                </span>{' '}
                <span className="font-medium text-white">{game.stakes}</span>
              </p>
            ) : null}
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
          ) : needsToJoin ? (
            <Link
              href={`/games/${game.code}/join`}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 font-semibold text-fairway-deep transition hover:bg-fairway-light"
            >
              Join this pool →
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
  substitutionCost: number;
};

function ParticipantRow({
  rank,
  participant,
  gameCode,
  color,
  isYou,
}: {
  rank: number;
  participant: ParticipantRow;
  gameCode: string;
  color: ParticipantColor | null;
  isYou: boolean;
}) {
  const beers = participant.picks.filter((p) => p.missedCut).length;
  return (
    <li
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition dark:bg-zinc-900 ${
        isYou
          ? 'border-fairway shadow-fairway/10'
          : 'border-zinc-200 hover:border-fairway/40 dark:border-zinc-800'
      }`}
    >
      <div className="flex items-center gap-4 px-4 py-3">
        <RankBadge rank={rank} />
        {color ? (
          <span
            className={`h-3 w-3 shrink-0 rounded-full ${color.swatch}`}
            aria-label={`${participant.displayName}'s color`}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-semibold">
            {participant.displayName}
            {isYou ? (
              <span className="rounded-full bg-fairway-light px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-fairway-deep dark:bg-fairway-deep dark:text-fairway-light">
                You
              </span>
            ) : null}
          </p>
          <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
            {beers > 0 ? (
              <span>
                🍺 owes {beers} beer{beers === 1 ? '' : 's'}
              </span>
            ) : null}
            {participant.substitutionCost < 0 ? (
              <span className="text-flag">
                sub cost {participant.substitutionCost}
              </span>
            ) : null}
          </div>
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
            <PickChip key={p.golferId} pick={p} gameCode={gameCode} />
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
  gameCode,
}: {
  pick: { golferId: number; name: string; points: number; missedCut: boolean; position: string | null };
  gameCode: string;
}) {
  return (
    <Link
      href={`/games/${gameCode}/golfer/${pick.golferId}`}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition hover:ring-fairway/60 ${
        pick.missedCut
          ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
          : 'bg-white text-zinc-800 ring-1 ring-zinc-200 hover:ring-fairway dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-700'
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
    </Link>
  );
}

function FieldScorecard({
  gameCode,
  golfers,
  holdersByGolfer,
  colorByParticipant,
  myParticipantId,
}: {
  gameCode: string;
  golfers: Array<{
    golferId: number;
    name: string;
    country: string | null;
    position: string | null;
    scoreToPar: number | null;
    missedCut: boolean;
    points: number;
  }>;
  holdersByGolfer: Map<number, Array<{ participantId: number; displayName: string }>>;
  colorByParticipant: Map<number, ParticipantColor>;
  myParticipantId: number | null;
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
        {golfers.map((g) => {
          const holders = holdersByGolfer.get(g.golferId) ?? [];
          const isMine =
            myParticipantId !== null &&
            holders.some((h) => h.participantId === myParticipantId);
          const myColor =
            isMine && myParticipantId !== null
              ? colorByParticipant.get(myParticipantId)
              : null;
          return (
            <li key={g.golferId}>
              <Link
                href={`/games/${gameCode}/golfer/${g.golferId}`}
                className={`grid grid-cols-[3.5rem_1fr_4rem_4.5rem] items-center gap-2 px-4 py-2 text-sm transition hover:bg-fairway-light/30 dark:hover:bg-fairway-deep/20 sm:grid-cols-[4rem_1fr_5rem_5rem] ${
                  myColor ? myColor.rowTint : ''
                }`}
              >
                <span className="font-mono text-xs font-semibold text-zinc-500">
                  {g.position ?? '—'}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <PickedByDots
                    holders={holders}
                    colorByParticipant={colorByParticipant}
                    myParticipantId={myParticipantId}
                  />
                  <span className="truncate">
                    {g.name}
                    {g.missedCut ? <span className="ml-1">🍺</span> : null}
                  </span>
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
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PickedByDots({
  holders,
  colorByParticipant,
  myParticipantId,
}: {
  holders: Array<{ participantId: number; displayName: string }>;
  colorByParticipant: Map<number, ParticipantColor>;
  myParticipantId: number | null;
}) {
  if (holders.length === 0) return null;
  // Put YOU first so your color anchors the row at a glance.
  const ordered = [...holders].sort((a, b) => {
    if (a.participantId === myParticipantId) return -1;
    if (b.participantId === myParticipantId) return 1;
    return a.participantId - b.participantId;
  });
  return (
    <span className="flex shrink-0 items-center -space-x-1">
      {ordered.map((h) => {
        const color = colorByParticipant.get(h.participantId);
        if (!color) return null;
        return (
          <span
            key={h.participantId}
            title={
              h.participantId === myParticipantId
                ? `${h.displayName} (you)`
                : h.displayName
            }
            className={`h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-900 ${color.swatch}`}
          />
        );
      })}
    </span>
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
