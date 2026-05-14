'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_TOP_PICK_COSTS, type ScoringRules } from '@/db/schema';

export function EditRulesForm({
  gameCode,
  currentRules,
}: {
  gameCode: string;
  currentRules: ScoringRules;
}) {
  const router = useRouter();
  const [rules, setRules] = useState<ScoringRules>({
    ...currentRules,
    top_pick_costs: currentRules.top_pick_costs ?? DEFAULT_TOP_PICK_COSTS,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChange = useMemo(
    () => JSON.stringify(rules) !== JSON.stringify(currentRules),
    [rules, currentRules],
  );

  function setRule<K extends keyof ScoringRules>(
    key: K,
    value: ScoringRules[K],
  ) {
    setRules((r) => ({ ...r, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!hasChange) {
      setError("Nothing's changed — adjust at least one value first");
      return;
    }
    if (
      !confirm(
        'Open a rule-change proposal? Every signed-in participant must approve before it takes effect.',
      )
    ) {
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/games/${gameCode}/rule-proposals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ afterRules: rules }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'failed to propose');
        setSubmitting(false);
        return;
      }
      router.push(`/games/${gameCode}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to propose');
      setSubmitting(false);
    }
  }

  const costs = rules.top_pick_costs ?? DEFAULT_TOP_PICK_COSTS;

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-6">
      <Section title="Per-hole points">
        <Grid>
          <NumberField label="Hole in one" value={rules.hole_in_one} onChange={(v) => setRule('hole_in_one', v)} />
          <NumberField label="Albatross" value={rules.albatross} onChange={(v) => setRule('albatross', v)} />
          <NumberField label="Eagle" value={rules.eagle} onChange={(v) => setRule('eagle', v)} />
          <NumberField label="Birdie" value={rules.birdie} onChange={(v) => setRule('birdie', v)} />
          <NumberField label="Par" value={rules.par} onChange={(v) => setRule('par', v)} />
          <NumberField label="Bogey" value={rules.bogey} onChange={(v) => setRule('bogey', v)} />
          <NumberField label="Double bogey" value={rules.double_bogey} onChange={(v) => setRule('double_bogey', v)} />
          <NumberField label="Triple+" value={rules.triple_plus} onChange={(v) => setRule('triple_plus', v)} />
        </Grid>
      </Section>
      <Section title="Finish bonuses">
        <Grid cols={3}>
          <NumberField label="1st place" value={rules.finish_1} onChange={(v) => setRule('finish_1', v)} />
          <NumberField label="2nd place" value={rules.finish_2} onChange={(v) => setRule('finish_2', v)} />
          <NumberField label="3rd place" value={rules.finish_3} onChange={(v) => setRule('finish_3', v)} />
        </Grid>
      </Section>
      <Section title="Top-pick substitution cost">
        <p className="-mt-1 mb-2 text-xs text-zinc-500">
          Past substitutions keep the cost they were charged at the time —
          changes here only affect new subs.
        </p>
        <Grid cols={5}>
          {costs.map((c, i) => (
            <NumberField
              key={i}
              label={`#${i + 1}`}
              value={c}
              max={0}
              onChange={(v) => {
                const next = [...costs];
                next[i] = Math.min(0, v);
                setRule('top_pick_costs', next);
              }}
            />
          ))}
        </Grid>
      </Section>

      <p className="text-xs text-zinc-500">
        Picks per player ({rules.picks_per_user}) is locked — it can&apos;t
        change after picks are made.
      </p>

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
          type="submit"
          disabled={submitting || !hasChange}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-fairway px-5 font-semibold text-white shadow-sm transition hover:bg-fairway-deep disabled:opacity-50"
        >
          {submitting ? 'Opening proposal…' : 'Propose change'} →
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">
        {title}
      </p>
      {children}
    </section>
  );
}

function Grid({
  children,
  cols = 4,
}: {
  children: React.ReactNode;
  cols?: number;
}) {
  const cls =
    cols === 5
      ? 'grid grid-cols-5 gap-3'
      : cols === 3
        ? 'grid grid-cols-3 gap-3'
        : 'grid grid-cols-2 gap-3 sm:grid-cols-4';
  return <div className={cls}>{children}</div>;
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
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-10 w-full rounded-lg border border-zinc-200 bg-cream px-2 text-right font-mono outline-none focus:border-fairway dark:border-zinc-700 dark:bg-zinc-950"
      />
    </label>
  );
}
