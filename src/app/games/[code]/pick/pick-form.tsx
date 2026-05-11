'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type FieldGolfer = {
  id: number;
  name: string;
  country: string | null;
  position: string | null;
  scoreToPar: number | null;
};

export function PickForm({
  gameCode,
  picksRequired,
  field,
}: {
  gameCode: string;
  picksRequired: number;
  field: FieldGolfer[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return field;
    return field.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.country ?? '').toLowerCase().includes(q),
    );
  }, [field, filter]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < picksRequired) {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (selected.size !== picksRequired) {
      setError(`Pick exactly ${picksRequired} golfers`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/picks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ golferIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'failed to submit picks');
        setSubmitting(false);
        return;
      }
      router.push(`/games/${gameCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to submit picks');
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-6 border-b border-zinc-200 bg-cream/95 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="flex items-center gap-3">
          <input
            placeholder="Search the field…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-11 flex-1 rounded-lg border border-zinc-200 bg-white px-3 outline-none transition focus:border-fairway focus:ring-2 focus:ring-fairway/30 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span
            className={`flex h-11 items-center gap-1 rounded-lg px-3 font-mono text-sm font-semibold tabular-nums ${
              selected.size === picksRequired
                ? 'bg-fairway-light text-fairway-deep dark:bg-fairway-deep dark:text-fairway-light'
                : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {selected.size} / {picksRequired}
          </span>
          <button
            onClick={handleSubmit}
            disabled={submitting || selected.size !== picksRequired}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-fairway px-5 font-semibold text-white shadow-sm transition hover:bg-fairway-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Locking…' : 'Lock picks'} <span>→</span>
          </button>
        </div>
        {error ? (
          <p className="mt-2 text-sm font-medium text-flag">{error}</p>
        ) : null}
      </div>

      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {filtered.map((g) => {
          const isSelected = selected.has(g.id);
          return (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => toggle(g.id)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                  isSelected
                    ? 'bg-fairway-light/60 dark:bg-fairway-deep/30'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
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
          );
        })}
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
