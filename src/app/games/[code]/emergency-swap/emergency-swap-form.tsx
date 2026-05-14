'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type MyPick = {
  pickId: number;
  golferId: number;
  name: string;
  position: string | null;
  scoreToPar: number | null;
};

type Choice = {
  id: number;
  name: string;
  country: string | null;
  position: string | null;
  scoreToPar: number | null;
  missedCut: boolean;
};

export function EmergencySwapForm({
  gameCode,
  myPicks,
  choices,
}: {
  gameCode: string;
  myPicks: MyPick[];
  choices: Choice[];
}) {
  const router = useRouter();
  const [droppedPickId, setDroppedPickId] = useState<number | null>(null);
  const [newGolferId, setNewGolferId] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? choices.filter(
          (g) =>
            g.name.toLowerCase().includes(q) ||
            (g.country ?? '').toLowerCase().includes(q),
        )
      : choices;
    return [...list].sort((a, b) => {
      if (a.missedCut !== b.missedCut) return a.missedCut ? 1 : -1;
      const ap = a.scoreToPar ?? 999;
      const bp = b.scoreToPar ?? 999;
      if (ap !== bp) return ap - bp;
      return a.name.localeCompare(b.name);
    });
  }, [choices, filter]);

  async function handleSubmit() {
    setError(null);
    if (droppedPickId === null) {
      setError('Pick which one of your golfers to swap out');
      return;
    }
    if (newGolferId === null) {
      setError('Pick the golfer you meant');
      return;
    }
    if (
      !confirm(
        'Open an emergency-swap proposal? Every other signed-in player will need to approve.',
      )
    ) {
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/games/${gameCode}/emergency-swaps`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ droppedPickId, newGolferId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'failed to request swap');
        setSubmitting(false);
        return;
      }
      router.push(`/games/${gameCode}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to request swap');
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          1. Which pick was the mistake?
        </h2>
        <ul className="mt-3 space-y-1">
          {myPicks.map((p) => {
            const isSelected = droppedPickId === p.pickId;
            return (
              <li key={p.pickId}>
                <button
                  type="button"
                  onClick={() => setDroppedPickId(p.pickId)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                    isSelected
                      ? 'bg-flag/10 ring-1 ring-flag/40'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                      isSelected
                        ? 'border-flag bg-flag text-white'
                        : 'border-zinc-300 dark:border-zinc-600'
                    }`}
                  >
                    {isSelected ? '×' : ''}
                  </span>
                  <span className="w-12 font-mono text-xs font-semibold text-zinc-500">
                    {p.position ?? '—'}
                  </span>
                  <span className="flex-1 truncate font-medium">{p.name}</span>
                  <ScoreToPar value={p.scoreToPar} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          2. Who did you mean to pick?
        </h2>
        <div className="mt-3 flex items-center gap-3">
          <input
            placeholder="Search the field…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-11 flex-1 rounded-lg border border-zinc-200 bg-cream px-3 outline-none focus:border-fairway focus:ring-2 focus:ring-fairway/30 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>
        <ul className="mt-3 max-h-[50vh] divide-y divide-zinc-100 overflow-y-auto rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {filtered.map((g) => {
            const isSelected = newGolferId === g.id;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => setNewGolferId(g.id)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                    isSelected
                      ? 'bg-fairway-light/60 ring-1 ring-fairway dark:bg-fairway-deep/40'
                      : 'hover:bg-fairway-light/30 dark:hover:bg-fairway-deep/20'
                  } ${g.missedCut ? 'opacity-60' : ''}`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                      isSelected
                        ? 'border-fairway bg-fairway text-white'
                        : 'border-zinc-300 dark:border-zinc-600'
                    }`}
                  >
                    {isSelected ? '✓' : ''}
                  </span>
                  <span className="w-12 font-mono text-xs font-semibold text-zinc-500">
                    {g.position ?? '—'}
                  </span>
                  <span className="flex-1 truncate font-medium">{g.name}</span>
                  {g.missedCut ? (
                    <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      🍺 Cut
                    </span>
                  ) : null}
                  <ScoreToPar value={g.scoreToPar} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {error ? <p className="text-sm font-medium text-flag">{error}</p> : null}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push(`/games/${gameCode}`)}
          className="inline-flex h-11 items-center rounded-full border border-zinc-300 px-5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || droppedPickId === null || newGolferId === null}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-fairway px-5 font-semibold text-white shadow-sm transition hover:bg-fairway-deep disabled:opacity-50"
        >
          {submitting ? 'Opening proposal…' : 'Request swap'} →
        </button>
      </div>
    </div>
  );
}

function ScoreToPar({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-sm text-zinc-400">—</span>;
  if (value === 0)
    return (
      <span className="font-mono text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        E
      </span>
    );
  if (value < 0)
    return (
      <span className="font-mono text-sm font-semibold text-flag">{value}</span>
    );
  return (
    <span className="font-mono text-sm text-zinc-700 dark:text-zinc-200">
      +{value}
    </span>
  );
}
