'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      <input
        type="text"
        placeholder="Game code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        maxLength={10}
        className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 font-mono text-base uppercase tracking-wider text-zinc-900 outline-none focus:border-emerald-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        required
      />
      <input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none focus:border-emerald-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        required
      />
      <button
        type="submit"
        disabled={submitting}
        className="h-11 rounded-md bg-zinc-900 px-6 font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {submitting ? 'Joining…' : 'Join'}
      </button>
      {error ? <p className="text-sm text-red-600 sm:basis-full">{error}</p> : null}
    </form>
  );
}
