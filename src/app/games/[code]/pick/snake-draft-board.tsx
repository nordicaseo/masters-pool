'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type FieldGolfer = {
  id: number;
  name: string;
  country: string | null;
  position: string | null;
  scoreToPar: number | null;
  /** Display name of the participant who picked this golfer, or null if available. */
  pickedBy: string | null;
};

type Participant = {
  id: number;
  displayName: string;
  isYou: boolean;
  isManual: boolean;
  picks: Array<{
    golferId: number;
    name: string;
    position: string | null;
    scoreToPar: number | null;
  }>;
};

export function SnakeDraftBoard({
  gameCode,
  round,
  totalRounds,
  currentPickerId,
  callerCanPick,
  actingAsCreator,
  participants,
  field,
  picksPerUser,
}: {
  gameCode: string;
  round: number;
  totalRounds: number;
  currentPickerId: number | null;
  callerCanPick: boolean;
  /** True when the caller is the creator picking for a manually-added player. */
  actingAsCreator: boolean;
  participants: Participant[];
  field: FieldGolfer[];
  picksPerUser: number;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPicker = useMemo(
    () => participants.find((p) => p.id === currentPickerId) ?? null,
    [participants, currentPickerId],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return field;
    return field.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.country ?? '').toLowerCase().includes(q),
    );
  }, [field, filter]);

  async function handlePick(golferId: number) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/picks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gameCode,
          golferId,
          participantId: actingAsCreator ? currentPickerId : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'failed to pick');
        setSubmitting(false);
        return;
      }
      // Refresh the server component so the next picker shows up.
      router.refresh();
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to pick');
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <TurnHeader
        round={round}
        totalRounds={totalRounds}
        currentPicker={currentPicker}
        callerCanPick={callerCanPick}
        actingAsCreator={actingAsCreator}
      />

      <DraftBoard participants={participants} picksPerUser={picksPerUser} currentPickerId={currentPickerId} />

      {callerCanPick ? (
        <div className="space-y-3 rounded-2xl border border-fairway bg-white p-4 shadow-sm dark:border-fairway-light/40 dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <input
              placeholder="Search the field…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-11 flex-1 rounded-lg border border-zinc-200 bg-cream px-3 outline-none focus:border-fairway focus:ring-2 focus:ring-fairway/30 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">
              {filtered.filter((g) => !g.pickedBy).length} available
            </span>
          </div>
          {error ? <p className="text-sm font-medium text-flag">{error}</p> : null}
          <ul className="max-h-[60vh] divide-y divide-zinc-100 overflow-y-auto rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {filtered.map((g) =>
              g.pickedBy ? (
                <li
                  key={g.id}
                  className="flex w-full items-center gap-3 bg-zinc-50/60 px-4 py-2.5 opacity-60 dark:bg-zinc-900/40"
                >
                  <span className="w-12 font-mono text-xs font-semibold text-zinc-400">
                    {g.position ?? '—'}
                  </span>
                  <span className="flex-1 truncate font-medium text-zinc-500 line-through dark:text-zinc-500">
                    {g.name}
                  </span>
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    Picked · {g.pickedBy}
                  </span>
                  <span className="w-12 text-right">
                    <ScoreToPar value={g.scoreToPar} />
                  </span>
                </li>
              ) : (
                <li key={g.id}>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handlePick(g.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-fairway-light/40 disabled:opacity-50 dark:hover:bg-fairway-deep/30"
                  >
                    <span className="w-12 font-mono text-xs font-semibold text-zinc-500">
                      {g.position ?? '—'}
                    </span>
                    <span className="flex-1 truncate font-medium">{g.name}</span>
                    {g.country ? (
                      <span className="hidden text-xs text-zinc-500 sm:inline">
                        {g.country}
                      </span>
                    ) : null}
                    <span className="w-12 text-right">
                      <ScoreToPar value={g.scoreToPar} />
                    </span>
                  </button>
                </li>
              ),
            )}
          </ul>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 p-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300">
          Waiting for <span className="font-semibold">{currentPicker?.displayName ?? '…'}</span> to pick.
          <button
            type="button"
            onClick={() => router.refresh()}
            className="ml-2 text-fairway hover:underline"
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}

function TurnHeader({
  round,
  totalRounds,
  currentPicker,
  callerCanPick,
  actingAsCreator,
}: {
  round: number;
  totalRounds: number;
  currentPicker: Participant | null;
  callerCanPick: boolean;
  actingAsCreator: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-fairway-deep/15 bg-white shadow-sm dark:border-fairway-light/20 dark:bg-zinc-900">
      <div className="scorecard-stripe flex items-center justify-between px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white">
        <span>Round {round} of {totalRounds}</span>
        <span>Snake draft</span>
      </div>
      <div className="flex items-center justify-between gap-4 p-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            {callerCanPick
              ? actingAsCreator
                ? "Pick for"
                : "Your turn — pick"
              : "Waiting for"}
          </p>
          <p className="font-display text-2xl font-bold">
            {currentPicker?.displayName ?? '—'}
          </p>
        </div>
        {callerCanPick ? (
          <span className="rounded-full bg-fairway px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
            On the clock
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DraftBoard({
  participants,
  picksPerUser,
  currentPickerId,
}: {
  participants: Participant[];
  picksPerUser: number;
  currentPickerId: number | null;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="scorecard-stripe px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white">
        Picks so far
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {participants.map((p) => (
          <li
            key={p.id}
            className={`grid grid-cols-[10rem_1fr] gap-3 px-4 py-2.5 text-sm transition ${
              currentPickerId === p.id ? 'bg-fairway-light/40 dark:bg-fairway-deep/30' : ''
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold">{p.displayName}</span>
              {p.isYou ? (
                <span className="rounded-full bg-fairway-light px-2 py-0.5 text-[10px] font-semibold text-fairway-deep dark:bg-fairway-deep dark:text-fairway-light">
                  You
                </span>
              ) : null}
              {p.isManual && !p.isYou ? (
                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  Manual
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: picksPerUser }).map((_, i) => {
                const pick = p.picks[i];
                return pick ? (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-fairway-light px-2 py-0.5 text-xs text-fairway-deep dark:bg-fairway-deep/40 dark:text-fairway-light"
                  >
                    <span className="font-mono text-[10px] text-zinc-500">
                      {pick.position ?? '—'}
                    </span>
                    <span className="font-medium">{pick.name}</span>
                  </span>
                ) : (
                  <span
                    key={i}
                    className="inline-flex h-6 items-center rounded-full border border-dashed border-zinc-300 px-3 text-[10px] text-zinc-400 dark:border-zinc-700 dark:text-zinc-600"
                  >
                    Slot {i + 1}
                  </span>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreToPar({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-sm text-zinc-400">—</span>;
  if (value === 0)
    return <span className="font-mono text-sm font-semibold text-zinc-700 dark:text-zinc-200">E</span>;
  if (value < 0)
    return <span className="font-mono text-sm font-semibold text-flag">{value}</span>;
  return <span className="font-mono text-sm text-zinc-700 dark:text-zinc-200">+{value}</span>;
}
