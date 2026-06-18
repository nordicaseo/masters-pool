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
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-fairway-deep/15 bg-white p-4 shadow-sm dark:border-fairway-light/20 dark:bg-zinc-900"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="GAME CODE"
          aria-label="Game code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
          maxLength={10}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-12 w-full rounded-lg border border-zinc-200 bg-cream px-4 font-mono text-base uppercase tracking-[0.25em] text-zinc-900 outline-none transition focus:border-fairway focus:ring-2 focus:ring-fairway/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          required
        />
        <input
          type="text"
          placeholder="Your name"
          aria-label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoComplete="name"
          autoCapitalize="words"
          className="h-12 w-full rounded-lg border border-zinc-200 bg-cream px-4 text-base text-zinc-900 outline-none transition focus:border-fairway focus:ring-2 focus:ring-fairway/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          required
        />
        <button
          type="submit"
          disabled={submitting}
          className="h-12 rounded-lg bg-fairway-deep px-6 font-semibold text-white transition hover:bg-fairway disabled:opacity-50"
        >
          {submitting ? 'Joining…' : 'Join'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-flag">
          {error}
        </p>
      ) : null}
    </form>
  );
}
