import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGameByCode } from '@/lib/games';
import { golferTotals, participantTotals } from '@/lib/scoring';
import { getParticipantForGame } from '@/lib/auth';
import { auth } from '@clerk/nextjs/server';
import { ShareInvite } from '@/app/_components/share-invite';
import { DeletePoolButton } from './delete-pool-button';
import { HouseRules } from './house-rules';
import { FieldLeaderboard } from './field-leaderboard';
import { canSubstitute } from '@/lib/substitutions';
import {
  diffScoringRules,
  getPendingProposal,
  getRecentResolvedProposals,
} from '@/lib/rule-changes';
import {
  getPendingSwap,
  getRecentResolvedSwaps,
} from '@/lib/emergency-swaps';
import {
  getGameActivityFeed,
  getSubstitutionHistoryByParticipant,
  type SubstitutionHistoryItem,
} from '@/lib/activity-feed';
import { RuleProposalBanner } from './rule-proposal-banner';
import { EmergencySwapBanner } from './emergency-swap-banner';
import { ActivityFeed } from './activity-feed';

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

  // Rule-change proposals + emergency swap proposals + activity feed +
  // per-participant substitution history — fetched together so the
  // page renders in a single round-trip's worth of waiting. The pending
  // proposals get prominent banners; resolved ones appear in small
  // audit-history sections below the House rules card. The activity
  // feed populates the sticky sidebar.
  const [
    pendingProposal,
    resolvedProposals,
    pendingSwap,
    resolvedSwaps,
    feedItems,
    subHistoryByParticipant,
  ] = await Promise.all([
    getPendingProposal(game.id),
    getRecentResolvedProposals(game.id, 5),
    getPendingSwap(game.id),
    getRecentResolvedSwaps(game.id, 5),
    getGameActivityFeed({
      gameId: game.id,
      viewerParticipantId: myParticipantId,
      limit: 50,
    }),
    getSubstitutionHistoryByParticipant(game.id),
  ]);
  const pendingDiff = pendingProposal
    ? diffScoringRules(pendingProposal.beforeRules, pendingProposal.afterRules)
    : [];
  const callerVote = pendingProposal && myParticipantId !== null
    ? pendingProposal.voters.find((v) => v.participantId === myParticipantId)
        ?.vote ?? null
    : null;
  const callerIsEligibleVoter =
    pendingProposal && myParticipantId !== null
      ? pendingProposal.voters.some(
          (v) => v.participantId === myParticipantId,
        )
      : false;

  // Mirror logic for the emergency-swap banner.
  const swapCallerVote =
    pendingSwap && myParticipantId !== null
      ? pendingSwap.voters.find((v) => v.participantId === myParticipantId)
          ?.vote ?? null
      : null;
  const swapCallerIsEligible =
    pendingSwap && myParticipantId !== null
      ? pendingSwap.voters.some((v) => v.participantId === myParticipantId)
      : false;

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

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
        {subWindow && myParticipantId !== null ? (
          <SubstitutionBanner gameCode={game.code} window={subWindow} />
        ) : null}

        {pendingSwap ? (
          <EmergencySwapBanner
            gameCode={game.code}
            proposalId={pendingSwap.id}
            participantDisplayName={pendingSwap.participantDisplayName}
            droppedGolferName={pendingSwap.droppedGolferName}
            newGolferName={pendingSwap.newGolferName}
            isProposer={userId === pendingSwap.proposedByUserId}
            callerCanVote={swapCallerIsEligible && swapCallerVote === null}
            callerHasVoted={swapCallerVote !== null}
            voters={pendingSwap.voters.map((v) => ({
              participantId: v.participantId,
              displayName: v.displayName,
              vote: v.vote,
            }))}
            approveCount={pendingSwap.tally.approveCount}
            eligibleCount={pendingSwap.tally.eligibleCount}
          />
        ) : null}

        {pendingProposal ? (
          <RuleProposalBanner
            gameCode={game.code}
            proposalId={pendingProposal.id}
            proposerDisplayName={
              pendingProposal.voters.find(
                (v) => v.userId === pendingProposal.proposedByUserId,
              )?.displayName ?? 'The creator'
            }
            isProposer={userId === pendingProposal.proposedByUserId}
            callerCanVote={callerIsEligibleVoter && callerVote === null}
            callerHasVoted={callerVote !== null}
            voters={pendingProposal.voters.map((v) => ({
              participantId: v.participantId,
              displayName: v.displayName,
              vote: v.vote,
            }))}
            diff={pendingDiff}
            approveCount={pendingProposal.tally.approveCount}
            eligibleCount={pendingProposal.tally.eligibleCount}
          />
        ) : null}

        <HouseRules
          scoringRules={game.scoringRules}
          draftMode={game.draftMode}
          rosterMode={game.rosterMode}
          startRound={game.startRound}
        />

        {resolvedProposals.length > 0 ? (
          <ResolvedProposalsList proposals={resolvedProposals} />
        ) : null}

        {resolvedSwaps.length > 0 ? (
          <ResolvedSwapsList swaps={resolvedSwaps} />
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
                  subHistory={
                    subHistoryByParticipant.get(u.participantId) ?? []
                  }
                />
              ))}
            </ol>
          )}
          {myParticipantId !== null &&
          !needsToPick &&
          !pendingSwap &&
          game.status !== 'post' ? (
            <p className="mt-3 text-center text-xs text-zinc-500">
              Picked the wrong golfer by mistake?{' '}
              <Link
                href={`/games/${game.code}/emergency-swap`}
                className="font-semibold text-flag underline-offset-2 hover:underline"
              >
                Request an emergency swap →
              </Link>
            </p>
          ) : null}
        </section>

        <section>
          <SectionHeader title="Field leaderboard" />
          {golfers.length === 0 ? (
            <EmptyState message="Field publishes a day or two before the tournament — check back closer to round 1." />
          ) : (
            <FieldLeaderboard
              gameCode={game.code}
              rows={golfers.map((g) => ({
                ...g,
                holders: (holdersByGolfer.get(g.golferId) ?? []).map((h) => {
                  const c = colorByParticipant.get(h.participantId);
                  return {
                    participantId: h.participantId,
                    displayName: h.displayName,
                    swatch: c?.swatch ?? '',
                    rowTint: c?.rowTint ?? '',
                  };
                }),
              }))}
              myParticipantId={myParticipantId}
            />
          )}
        </section>

        {isCreator ? (
          <section className="mt-12 border-t border-zinc-200 pt-6 dark:border-zinc-800">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Creator tools
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {game.status !== 'post' && !pendingProposal ? (
                <Link
                  href={`/games/${game.code}/edit-rules`}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-fairway/40 px-4 text-sm font-semibold text-fairway transition hover:bg-fairway/10"
                >
                  ✎ Propose rule change
                </Link>
              ) : null}
              <DeletePoolButton gameCode={game.code} gameName={game.name} />
            </div>
          </section>
        ) : null}
          </div>
          <div className="lg:sticky lg:top-4 lg:self-start">
            <ActivityFeed items={feedItems} />
          </div>
        </div>
      </div>
    </main>
  );
}

function ResolvedProposalsList({
  proposals,
}: {
  proposals: Array<{
    id: number;
    status: 'approved' | 'rejected' | 'cancelled' | 'pending';
    proposedByUserId: string;
    proposedAt: Date;
    resolvedAt: Date | null;
    beforeRules: import('@/db/schema').ScoringRules;
    afterRules: import('@/db/schema').ScoringRules;
  }>;
}) {
  return (
    <details className="mb-8 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
        Rule change history · {proposals.length}
      </summary>
      <ul className="mt-3 space-y-2">
        {proposals.map((p) => {
          const diff = diffScoringRules(p.beforeRules, p.afterRules);
          const statusLabel =
            p.status === 'approved'
              ? '✓ Approved'
              : p.status === 'rejected'
                ? '✗ Rejected'
                : 'Cancelled';
          const statusCls =
            p.status === 'approved'
              ? 'text-fairway-deep'
              : p.status === 'rejected'
                ? 'text-flag'
                : 'text-zinc-500';
          return (
            <li
              key={p.id}
              className="rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={`text-xs font-semibold ${statusCls}`}>
                  {statusLabel}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                  {p.resolvedAt
                    ? new Date(p.resolvedAt).toLocaleString()
                    : '—'}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                {diff.length === 0 ? (
                  <span className="text-zinc-500">(no-op)</span>
                ) : (
                  diff.map((d) => (
                    <span
                      key={d.key}
                      className="font-mono"
                    >
                      <span className="text-zinc-500">{d.label}:</span>{' '}
                      <span className="text-flag line-through">{d.before}</span>{' '}
                      →{' '}
                      <span className="text-fairway-deep">{d.after}</span>
                    </span>
                  ))
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function ResolvedSwapsList({
  swaps,
}: {
  swaps: Array<{
    id: number;
    status: 'approved' | 'rejected' | 'cancelled' | 'pending';
    proposedByUserId: string;
    proposedAt: Date;
    resolvedAt: Date | null;
    participantDisplayName: string;
    droppedGolferName: string;
    newGolferName: string;
  }>;
}) {
  return (
    <details className="mb-8 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
        Emergency swap history · {swaps.length}
      </summary>
      <ul className="mt-3 space-y-2">
        {swaps.map((s) => {
          const statusLabel =
            s.status === 'approved'
              ? '✓ Approved'
              : s.status === 'rejected'
                ? '✗ Rejected'
                : 'Cancelled';
          const statusCls =
            s.status === 'approved'
              ? 'text-fairway-deep'
              : s.status === 'rejected'
                ? 'text-flag'
                : 'text-zinc-500';
          return (
            <li
              key={s.id}
              className="rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={`text-xs font-semibold ${statusCls}`}>
                  {statusLabel}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                  {s.resolvedAt
                    ? new Date(s.resolvedAt).toLocaleString()
                    : '—'}
                </span>
              </div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                <span className="font-semibold">
                  {s.participantDisplayName}
                </span>
                :{' '}
                <span className="text-flag line-through">
                  {s.droppedGolferName}
                </span>{' '}
                →{' '}
                <span className="text-fairway-deep dark:text-fairway-light">
                  {s.newGolferName}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
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
    stakeItems: import('@/db/schema').StakeItems | null;
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
            <StakesLine stakes={game.stakes} stakeItems={game.stakeItems} />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-fairway-light/90">
              <ShareInvite code={game.code} gameName={game.name} tone="dark" />
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

function StakesLine({
  stakes,
  stakeItems,
}: {
  stakes: string | null;
  stakeItems: import('@/db/schema').StakeItems | null;
}) {
  const chips: Array<{ emoji: string; label: string }> = [];
  if (stakeItems) {
    if ((stakeItems.beers ?? 0) > 0) {
      chips.push({
        emoji: '🍺',
        label: `${stakeItems.beers} beer${stakeItems.beers === 1 ? '' : 's'}`,
      });
    }
    if ((stakeItems.hotDogs ?? 0) > 0) {
      chips.push({
        emoji: '🌭',
        label: `${stakeItems.hotDogs} hot dog${stakeItems.hotDogs === 1 ? '' : 's'}`,
      });
    }
    if ((stakeItems.hotSoup ?? 0) > 0) {
      chips.push({
        emoji: '🥣',
        label: `${stakeItems.hotSoup} hot soup${stakeItems.hotSoup === 1 ? '' : 's'}`,
      });
    }
    if (stakeItems.other?.trim()) {
      chips.push({ emoji: '🎁', label: stakeItems.other.trim() });
    }
  }
  if (chips.length === 0) {
    if (!stakes) return null;
    return (
      <p className="mt-2 text-sm text-fairway-light/90">
        <span className="font-semibold uppercase tracking-wider text-fairway-light/70">
          Playing for:
        </span>{' '}
        <span className="font-medium text-white">{stakes}</span>
      </p>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
      <span className="font-semibold uppercase tracking-wider text-fairway-light/70">
        Playing for:
      </span>
      {chips.map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium text-white"
        >
          <span aria-hidden>{c.emoji}</span>
          <span>{c.label}</span>
        </span>
      ))}
    </div>
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
  subHistory,
}: {
  rank: number;
  participant: ParticipantRow;
  gameCode: string;
  color: ParticipantColor | null;
  isYou: boolean;
  subHistory: SubstitutionHistoryItem[];
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
      {subHistory.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-zinc-100 bg-amber-50/40 px-4 py-2 text-[11px] dark:border-zinc-800 dark:bg-amber-950/15">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-amber-700 dark:text-amber-300">
            Subs
          </span>
          {subHistory.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300"
            >
              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                {s.window === 'day_1' ? 'D1' : 'D2'}
              </span>
              <span className="text-flag line-through">
                {s.droppedGolferName}
              </span>
              <span className="text-zinc-400">→</span>
              <span className="text-fairway-deep dark:text-fairway-light">
                {s.newGolferName}
              </span>
              {s.costPoints < 0 ? (
                <span className="font-mono text-flag">
                  ({s.costPoints})
                </span>
              ) : null}
            </span>
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

