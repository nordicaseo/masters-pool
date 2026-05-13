'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeletePoolButton({
  gameCode,
  gameName,
}: {
  gameCode: string;
  gameName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const ok = window.confirm(
      `Delete "${gameName}"?\n\nThis removes every participant, pick, and scoring event for this pool. This cannot be undone.`,
    );
    if (!ok) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameCode}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'failed to delete');
        setPending(false);
        return;
      }
      router.push('/games');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete');
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-flag/40 px-4 text-sm font-semibold text-flag transition hover:bg-flag/10 disabled:opacity-50"
      >
        {pending ? 'Deleting…' : 'Delete pool'}
      </button>
      {error ? (
        <span className="text-xs font-medium text-flag">{error}</span>
      ) : null}
    </div>
  );
}
