'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type Holder = {
  participantId: number;
  displayName: string;
  /** Tailwind swatch class baked in server-side so this component stays serializable. */
  swatch: string;
  /** Row-tint Tailwind class for the holder's color. */
  rowTint: string;
};

type FieldRow = {
  golferId: number;
  name: string;
  country: string | null;
  position: string | null;
  scoreToPar: number | null;
  missedCut: boolean;
  points: number;
  /** Participants currently holding this golfer (active pick). */
  holders: Holder[];
};

/**
 * Field leaderboard for the game page. Sorted by golf position
 * server-side (we never re-sort on the client). Adds a "Pool picks
 * only" filter toggle so participants can quickly check just the
 * golfers in the pool.
 */
export function FieldLeaderboard({
  gameCode,
  rows,
  myParticipantId,
}: {
  gameCode: string;
  rows: FieldRow[];
  myParticipantId: number | null;
}) {
  const [poolOnly, setPoolOnly] = useState(false);

  const heldCount = useMemo(
    () => rows.filter((r) => r.holders.length > 0).length,
    [rows],
  );

  const visible = useMemo(
    () => (poolOnly ? rows.filter((r) => r.holders.length > 0) : rows),
    [rows, poolOnly],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">
          {poolOnly
            ? `${visible.length} pool pick${visible.length === 1 ? '' : 's'}`
            : `${rows.length} golfers`}
        </span>
        <FilterToggle
          poolOnly={poolOnly}
          onToggle={() => setPoolOnly((s) => !s)}
          heldCount={heldCount}
          disabled={heldCount === 0}
        />
      </div>
      <div className="scorecard-stripe grid grid-cols-[3.5rem_1fr_4rem_4.5rem] gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white sm:grid-cols-[4rem_1fr_5rem_5rem]">
        <span>Pos</span>
        <span>Golfer</span>
        <span className="text-right">To par</span>
        <span className="text-right">Points</span>
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {visible.map((g) => {
          const mine =
            myParticipantId !== null
              ? g.holders.find((h) => h.participantId === myParticipantId)
              : null;
          return (
            <li key={g.golferId}>
              <Link
                href={`/games/${gameCode}/golfer/${g.golferId}`}
                className={`grid grid-cols-[3.5rem_1fr_4rem_4.5rem] items-center gap-2 px-4 py-2 text-sm transition hover:bg-fairway-light/30 dark:hover:bg-fairway-deep/20 sm:grid-cols-[4rem_1fr_5rem_5rem] ${
                  mine ? mine.rowTint : ''
                }`}
              >
                <span className="font-mono text-xs font-semibold text-zinc-500">
                  {g.position ?? '—'}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <PickedByDots
                    holders={g.holders}
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
        {visible.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-zinc-500">
            No pool picks to show — toggle &ldquo;Pool picks only&rdquo; off to see the full field.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function FilterToggle({
  poolOnly,
  onToggle,
  heldCount,
  disabled,
}: {
  poolOnly: boolean;
  onToggle: () => void;
  heldCount: number;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-50 ${
        poolOnly
          ? 'border-fairway bg-fairway text-white hover:bg-fairway-deep'
          : 'border-zinc-300 bg-white text-zinc-700 hover:border-fairway hover:text-fairway dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
      }`}
      title={disabled ? 'No pool picks yet' : undefined}
    >
      {poolOnly ? '✓ Pool picks only' : `Pool picks only · ${heldCount}`}
    </button>
  );
}

function PickedByDots({
  holders,
  myParticipantId,
}: {
  holders: Holder[];
  myParticipantId: number | null;
}) {
  if (holders.length === 0) return null;
  const ordered = [...holders].sort((a, b) => {
    if (a.participantId === myParticipantId) return -1;
    if (b.participantId === myParticipantId) return 1;
    return a.participantId - b.participantId;
  });
  return (
    <span className="flex shrink-0 items-center -space-x-1">
      {ordered.map((h) => (
        <span
          key={h.participantId}
          title={
            h.participantId === myParticipantId
              ? `${h.displayName} (you)`
              : h.displayName
          }
          className={`h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-900 ${h.swatch}`}
        />
      ))}
    </span>
  );
}

function ScoreToPar({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-zinc-400">—</span>;
  if (value === 0)
    return (
      <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-200">
        E
      </span>
    );
  if (value < 0)
    return <span className="font-mono font-semibold text-flag">{value}</span>;
  return (
    <span className="font-mono text-zinc-700 dark:text-zinc-200">+{value}</span>
  );
}
