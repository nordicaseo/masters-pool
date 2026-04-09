'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_SCORING_RULES, type ScoringRules } from '@/db/schema';

const DEFAULT_EVENT_ID = '401811941';
const DEFAULT_TOURNAMENT_NAME = 'Masters Tournament';

export function CreateGameForm() {
  const router = useRouter();
  const [name, setName] = useState('Masters Pool 2026');
  const [createdByName, setCreatedByName] = useState('');
  const [espnEventId, setEspnEventId] = useState(DEFAULT_EVENT_ID);
  const [tournamentName, setTournamentName] = useState(DEFAULT_TOURNAMENT_NAME);
  const [rules, setRules] = useState<ScoringRules>(DEFAULT_SCORING_RULES);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setRule<K extends keyof ScoringRules>(key: K, value: ScoringRules[K]) {
    setRules((r) => ({ ...r, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          createdByName,
          espnEventId,
          tournamentName,
          scoringRules: rules,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'failed to create game');
        setSubmitting(false);
        return;
      }
      router.push(`/games/${data.code}/pick`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create game');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="space-y-4">
        <Field label="Pool name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </Field>
        <Field label="Your name">
          <input
            value={createdByName}
            onChange={(e) => setCreatedByName(e.target.value)}
            maxLength={40}
            required
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </Field>
        <Field label="Tournament name">
          <input
            value={tournamentName}
            onChange={(e) => setTournamentName(e.target.value)}
            maxLength={120}
            required
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </Field>
        <Field
          label="ESPN event id"
          hint="Find this in the URL on espn.com/golf/leaderboard. The 2026 Masters is 401811941."
        >
          <input
            value={espnEventId}
            onChange={(e) => setEspnEventId(e.target.value)}
            maxLength={40}
            required
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-900"
          />
        </Field>
      </div>

      <fieldset className="space-y-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <legend className="px-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Scoring rules
        </legend>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumberField label="Hole in one" value={rules.hole_in_one} onChange={(v) => setRule('hole_in_one', v)} />
          <NumberField label="Albatross" value={rules.albatross} onChange={(v) => setRule('albatross', v)} />
          <NumberField label="Eagle" value={rules.eagle} onChange={(v) => setRule('eagle', v)} />
          <NumberField label="Birdie" value={rules.birdie} onChange={(v) => setRule('birdie', v)} />
          <NumberField label="Par" value={rules.par} onChange={(v) => setRule('par', v)} />
          <NumberField label="Bogey" value={rules.bogey} onChange={(v) => setRule('bogey', v)} />
          <NumberField label="Double bogey" value={rules.double_bogey} onChange={(v) => setRule('double_bogey', v)} />
          <NumberField label="Triple+" value={rules.triple_plus} onChange={(v) => setRule('triple_plus', v)} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <NumberField label="1st place" value={rules.finish_1} onChange={(v) => setRule('finish_1', v)} />
          <NumberField label="2nd place" value={rules.finish_2} onChange={(v) => setRule('finish_2', v)} />
          <NumberField label="3rd place" value={rules.finish_3} onChange={(v) => setRule('finish_3', v)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            label="Picks per user"
            value={rules.picks_per_user}
            onChange={(v) => setRule('picks_per_user', v)}
            min={1}
            max={10}
          />
          <Field label="Tie handling">
            <select
              value={rules.tie_handling}
              onChange={(e) => setRule('tie_handling', e.target.value as ScoringRules['tie_handling'])}
              className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="split_floor">Split (floor)</option>
              <option value="full">Full to each tied golfer</option>
            </select>
          </Field>
        </div>
      </fieldset>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={submitting}
        className="h-11 rounded-md bg-emerald-600 px-6 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Create pool'}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-10 w-full rounded-md border border-zinc-300 bg-white px-2 text-right font-mono dark:border-zinc-700 dark:bg-zinc-900"
      />
    </label>
  );
}
