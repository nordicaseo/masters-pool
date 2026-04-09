'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function JoinNamedForm({ code }: { code: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/games/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, displayName: name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'failed to join');
        setSubmitting(false);
        return;
      }
      router.push(`/games/${data.code}/pick`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to join');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        required
        className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        disabled={submitting}
        className="h-11 w-full rounded-md bg-emerald-600 px-6 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
      >
        {submitting ? 'Joining…' : 'Join the pool'}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
