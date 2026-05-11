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
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-2xl border border-fairway-deep/15 bg-white p-4 shadow-sm dark:border-fairway-light/20 dark:bg-zinc-900"
    >
      <input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        required
        className="h-12 w-full rounded-lg border border-zinc-200 bg-cream px-3 outline-none transition focus:border-fairway focus:ring-2 focus:ring-fairway/30 dark:border-zinc-700 dark:bg-zinc-950"
      />
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-fairway px-6 font-semibold text-white shadow-sm transition hover:bg-fairway-deep disabled:opacity-50"
      >
        {submitting ? 'Joining…' : 'Join the pool'} <span>→</span>
      </button>
      {error ? (
        <p className="text-sm font-medium text-flag">{error}</p>
      ) : null}
    </form>
  );
}
