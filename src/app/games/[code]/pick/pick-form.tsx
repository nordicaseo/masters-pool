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
    return field.filter((g) => g.name.toLowerCase().includes(q));
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
      <div className="sticky top-0 z-10 -mx-6 border-b border-zinc-200 bg-white/95 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="flex items-center gap-3">
          <input
            placeholder="Search field…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-10 flex-1 rounded-md border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
            {selected.size} / {picksRequired}
          </span>
          <button
            onClick={handleSubmit}
            disabled={submitting || selected.size !== picksRequired}
            className="h-10 rounded-md bg-emerald-600 px-4 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? 'Locking…' : 'Lock picks'}
          </button>
        </div>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </div>

      <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {filtered.map((g) => {
          const isSelected = selected.has(g.id);
          return (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => toggle(g.id)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${
                  isSelected
                    ? 'bg-emerald-50 dark:bg-emerald-950/40'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded border ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-zinc-400'
                  }`}
                >
                  {isSelected ? '✓' : ''}
                </span>
                <span className="w-12 font-mono text-xs text-zinc-500">{g.position ?? '-'}</span>
                <span className="flex-1">{g.name}</span>
                {g.country ? <span className="text-xs text-zinc-500">{g.country}</span> : null}
                <span className="w-12 text-right font-mono text-sm tabular-nums">
                  {g.scoreToPar === null
                    ? '-'
                    : g.scoreToPar === 0
                      ? 'E'
                      : g.scoreToPar > 0
                        ? `+${g.scoreToPar}`
                        : g.scoreToPar}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
