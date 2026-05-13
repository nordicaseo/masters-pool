'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_SCORING_RULES,
  type DraftMode,
  type RosterMode,
  type ScoringRules,
} from '@/db/schema';
import type { ScheduledTournament } from '@/lib/espn';

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export function CreateGameForm({
  upcoming,
  past,
  suggestedName,
}: {
  upcoming: ScheduledTournament[];
  past: ScheduledTournament[];
  suggestedName?: string;
}) {
  const router = useRouter();
  const tournaments = useMemo(() => [...upcoming, ...past], [upcoming, past]);
  const [selectedEventId, setSelectedEventId] = useState<string>(
    upcoming[0]?.espnEventId ?? past[0]?.espnEventId ?? '',
  );
  const [showPast, setShowPast] = useState(false);
  const [manualEventId, setManualEventId] = useState('');
  const [manualName, setManualName] = useState('');
  const [poolName, setPoolName] = useState('');
  const [createdByName, setCreatedByName] = useState(suggestedName ?? '');
  const [stakes, setStakes] = useState('');
  const [rules, setRules] = useState<ScoringRules>(DEFAULT_SCORING_RULES);
  const [showRules, setShowRules] = useState(false);
  const [rosterMode, setRosterMode] = useState<RosterMode>('open');
  const [draftMode, setDraftMode] = useState<DraftMode>('free');
  const [maxPlayers, setMaxPlayers] = useState<number>(4);
  const [manualPlayerNames, setManualPlayerNames] = useState<string[]>(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => tournaments.find((t) => t.espnEventId === selectedEventId) ?? null,
    [tournaments, selectedEventId],
  );

  const effective = useMemo(() => {
    if (selectedEventId === '__manual__') {
      return manualEventId
        ? { espnEventId: manualEventId, tournamentName: manualName || 'Custom event' }
        : null;
    }
    return selected
      ? { espnEventId: selected.espnEventId, tournamentName: selected.name }
      : null;
  }, [selectedEventId, manualEventId, manualName, selected]);

  // Auto-suggest pool name from tournament selection, but let the user override.
  const suggestedPoolName = effective ? `${effective.tournamentName} Pool` : '';
  const effectivePoolName = poolName.trim() || suggestedPoolName;

  function setRule<K extends keyof ScoringRules>(key: K, value: ScoringRules[K]) {
    setRules((r) => ({ ...r, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!effective) {
      setError('Pick a tournament');
      return;
    }
    if (!createdByName.trim()) {
      setError('Enter your name');
      return;
    }
    // Validate roster/draft mode combinations on the client for a snappy
    // error before round-tripping to the server.
    const cleanedManualNames = manualPlayerNames.map((n) => n.trim()).filter(Boolean);
    if (rosterMode === 'manual' && cleanedManualNames.length < 1) {
      setError('Add at least one other player to the manual roster');
      return;
    }
    if (
      draftMode === 'snake' &&
      rosterMode === 'manual' &&
      cleanedManualNames.length < 1
    ) {
      setError('Snake draft needs at least 2 players (you + 1 other)');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: effectivePoolName,
          createdByName,
          espnEventId: effective.espnEventId,
          tournamentName: effective.tournamentName,
          scoringRules: rules,
          rosterMode,
          draftMode,
          maxPlayers: rosterMode === 'open' && draftMode === 'snake' ? maxPlayers : undefined,
          manualPlayerNames: rosterMode === 'manual' ? cleanedManualNames : undefined,
          stakes: stakes.trim() || undefined,
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
      <Step number={1} title="Pick the tournament">
        {tournaments.length === 0 ? (
          <ManualEntry
            eventId={manualEventId}
            setEventId={(v) => {
              setManualEventId(v);
              setSelectedEventId('__manual__');
            }}
            name={manualName}
            setName={setManualName}
          />
        ) : (
          <div className="space-y-4">
            {upcoming.length > 0 ? (
              <div className="space-y-2">
                <SectionLabel>Upcoming &amp; live</SectionLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  {upcoming.map((t) => (
                    <TournamentCard
                      key={t.espnEventId}
                      tournament={t}
                      selected={selectedEventId === t.espnEventId}
                      onSelect={() => setSelectedEventId(t.espnEventId)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {past.length > 0 ? (
              <div className="space-y-2 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/40 p-3 dark:border-zinc-700 dark:bg-zinc-900/40">
                <button
                  type="button"
                  onClick={() => setShowPast((s) => !s)}
                  className="flex w-full items-center justify-between text-left text-sm font-medium transition"
                >
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      Past · for testing
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      Replay a finished tournament to see scoring &amp; leaderboards populate
                    </span>
                  </span>
                  <span className="text-zinc-400">{showPast ? '−' : '+'}</span>
                </button>
                {showPast ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {past.map((t) => (
                      <TournamentCard
                        key={t.espnEventId}
                        tournament={t}
                        selected={selectedEventId === t.espnEventId}
                        onSelect={() => setSelectedEventId(t.espnEventId)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </Step>

      <Step number={2} title="Name your pool">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pool name">
              <input
                value={poolName}
                onChange={(e) => setPoolName(e.target.value)}
                placeholder={suggestedPoolName || 'My pool'}
                maxLength={80}
                className="h-11 w-full rounded-lg border border-zinc-200 bg-cream px-3 outline-none transition focus:border-fairway focus:ring-2 focus:ring-fairway/30 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </Field>
            <Field label="Your name">
              <input
                value={createdByName}
                onChange={(e) => setCreatedByName(e.target.value)}
                placeholder="Who's running this?"
                maxLength={40}
                required
                className="h-11 w-full rounded-lg border border-zinc-200 bg-cream px-3 outline-none transition focus:border-fairway focus:ring-2 focus:ring-fairway/30 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </Field>
          </div>
          <Field label="Stakes (optional)">
            <input
              value={stakes}
              onChange={(e) => setStakes(e.target.value)}
              placeholder="a beer, hot dogs, hot soup"
              maxLength={200}
              className="h-11 w-full rounded-lg border border-zinc-200 bg-cream px-3 outline-none transition focus:border-fairway focus:ring-2 focus:ring-fairway/30 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <p className="mt-1 text-xs text-zinc-500">
              What is the group playing for? Shown on the pool page.
            </p>
          </Field>
        </div>
      </Step>

      <Step number={3} title="Format">
        <div className="space-y-5 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <SectionLabel>Roster</SectionLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              <ModeCard
                title="Open"
                description="Anyone with the code can join."
                selected={rosterMode === 'open'}
                onSelect={() => setRosterMode('open')}
              />
              <ModeCard
                title="Manual"
                description="You add the player names. No signup needed."
                selected={rosterMode === 'manual'}
                onSelect={() => setRosterMode('manual')}
              />
            </div>
          </div>
          <div>
            <SectionLabel>Draft</SectionLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              <ModeCard
                title="Free"
                description="Pick independently. Duplicates allowed."
                selected={draftMode === 'free'}
                onSelect={() => setDraftMode('free')}
              />
              <ModeCard
                title="Snake draft"
                description="Take turns in random order. No duplicates."
                selected={draftMode === 'snake'}
                onSelect={() => setDraftMode('snake')}
              />
            </div>
          </div>
          {rosterMode === 'open' && draftMode === 'snake' ? (
            <Field label="How many players?">
              <input
                type="number"
                min={2}
                max={10}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
                className="h-10 w-32 rounded-lg border border-zinc-200 bg-cream px-3 font-mono outline-none focus:border-fairway dark:border-zinc-700 dark:bg-zinc-950"
              />
              <p className="mt-1 text-xs text-zinc-500">
                Draft starts as soon as the {maxPlayers}th player joins.
              </p>
            </Field>
          ) : null}
          {rosterMode === 'manual' ? (
            <div>
              <SectionLabel>Other players (besides you)</SectionLabel>
              <ManualNameList
                names={manualPlayerNames}
                onChange={setManualPlayerNames}
              />
              <p className="mt-2 text-xs text-zinc-500">
                {draftMode === 'snake'
                  ? `You and ${manualPlayerNames.filter((n) => n.trim()).length} other${manualPlayerNames.filter((n) => n.trim()).length === 1 ? '' : 's'} — ${1 + manualPlayerNames.filter((n) => n.trim()).length} players total.`
                  : "You'll pick golfers for each player from the pool page."}
              </p>
            </div>
          ) : null}
        </div>
      </Step>

      <Step number={4} title="Scoring">
        <div className="rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setShowRules((s) => !s)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <span className="flex items-center gap-2">
              {showRules ? 'Hide scoring rules' : 'Customize scoring rules'}
              <span className="rounded-full bg-fairway-light px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fairway-deep dark:bg-fairway-deep dark:text-fairway-light">
                Defaults set
              </span>
            </span>
            <span className="text-zinc-400">{showRules ? '−' : '+'}</span>
          </button>
          {showRules ? (
            <div className="space-y-6 p-3 pt-4">
              <div>
                <SectionLabel>Per-hole points</SectionLabel>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <NumberField label="Hole in one" value={rules.hole_in_one} onChange={(v) => setRule('hole_in_one', v)} />
                  <NumberField label="Albatross" value={rules.albatross} onChange={(v) => setRule('albatross', v)} />
                  <NumberField label="Eagle" value={rules.eagle} onChange={(v) => setRule('eagle', v)} />
                  <NumberField label="Birdie" value={rules.birdie} onChange={(v) => setRule('birdie', v)} />
                  <NumberField label="Par" value={rules.par} onChange={(v) => setRule('par', v)} />
                  <NumberField label="Bogey" value={rules.bogey} onChange={(v) => setRule('bogey', v)} />
                  <NumberField label="Double bogey" value={rules.double_bogey} onChange={(v) => setRule('double_bogey', v)} />
                  <NumberField label="Triple+" value={rules.triple_plus} onChange={(v) => setRule('triple_plus', v)} />
                </div>
              </div>
              <div>
                <SectionLabel>Finish bonuses</SectionLabel>
                <div className="grid grid-cols-3 gap-3">
                  <NumberField label="1st place" value={rules.finish_1} onChange={(v) => setRule('finish_1', v)} />
                  <NumberField label="2nd place" value={rules.finish_2} onChange={(v) => setRule('finish_2', v)} />
                  <NumberField label="3rd place" value={rules.finish_3} onChange={(v) => setRule('finish_3', v)} />
                </div>
              </div>
              <div>
                <SectionLabel>Pool format</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="Picks per player"
                    value={rules.picks_per_user}
                    onChange={(v) => setRule('picks_per_user', v)}
                    min={1}
                    max={10}
                  />
                  <Field label="Tie handling">
                    <select
                      value={rules.tie_handling}
                      onChange={(e) =>
                        setRule('tie_handling', e.target.value as ScoringRules['tie_handling'])
                      }
                      className="h-10 w-full rounded-lg border border-zinc-200 bg-cream px-2 outline-none focus:border-fairway dark:border-zinc-700 dark:bg-zinc-950"
                    >
                      <option value="split_floor">Split pool evenly</option>
                      <option value="full">Each tied golfer gets the full place</option>
                    </select>
                  </Field>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Step>

      {error ? <p className="text-sm font-medium text-flag">{error}</p> : null}
      <button
        type="submit"
        disabled={submitting || !effective}
        className="inline-flex h-12 items-center gap-2 rounded-full bg-fairway px-6 font-semibold text-white shadow-sm transition hover:bg-fairway-deep disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Create pool'}
        <span>→</span>
      </button>
    </form>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-fairway-deep font-mono text-xs font-bold text-white">
          {number}
        </span>
        <h2 className="font-display text-xl font-bold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function TournamentCard({
  tournament,
  selected,
  onSelect,
}: {
  tournament: ScheduledTournament;
  selected: boolean;
  onSelect: () => void;
}) {
  const date = new Date(tournament.startDate);
  const isLive = tournament.state === 'in';
  const isPost = tournament.state === 'post';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex items-start gap-3 rounded-xl border p-3 text-left transition ${
        selected
          ? 'border-fairway bg-fairway-light/60 shadow-sm dark:bg-fairway-deep/40'
          : 'border-zinc-200 bg-white hover:border-fairway/60 hover:bg-fairway-light/30 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-fairway-deep/20'
      }`}
    >
      <div
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          selected
            ? 'border-fairway bg-fairway text-white'
            : 'border-zinc-300 dark:border-zinc-600'
        }`}
      >
        {selected ? '✓' : ''}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{tournament.name}</span>
          {tournament.isMajor ? (
            <span className="rounded-full bg-podium-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              Major
            </span>
          ) : null}
          {isLive ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-flag px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              Live
            </span>
          ) : null}
          {isPost ? (
            <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              Final
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 font-mono text-xs uppercase tracking-wider text-zinc-500">
          {DATE_FMT.format(date)}
        </p>
      </div>
    </button>
  );
}

function ManualEntry({
  eventId,
  setEventId,
  name,
  setName,
}: {
  eventId: string;
  setEventId: (v: string) => void;
  name: string;
  setName: (v: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="text-sm text-amber-900 dark:text-amber-200">
        Couldn&apos;t reach ESPN to load the schedule — enter the event id manually
        (find it in the URL on espn.com/golf/leaderboard).
      </p>
      <Field label="ESPN event id">
        <input
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          maxLength={40}
          className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 font-mono dark:border-zinc-700 dark:bg-zinc-950"
        />
      </Field>
      <Field label="Tournament name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-950"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
      {children}
    </p>
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

function ModeCard({
  title,
  description,
  selected,
  onSelect,
}: {
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
        selected
          ? 'border-fairway bg-fairway-light/60 shadow-sm dark:bg-fairway-deep/40'
          : 'border-zinc-200 bg-cream hover:border-fairway/60 hover:bg-fairway-light/30 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-fairway-deep/20'
      }`}
    >
      <div
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? 'border-fairway bg-fairway text-white' : 'border-zinc-300 dark:border-zinc-600'
        }`}
      >
        {selected ? '✓' : ''}
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{description}</p>
      </div>
    </button>
  );
}

function ManualNameList({
  names,
  onChange,
}: {
  names: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      {names.map((n, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-6 text-right font-mono text-xs text-zinc-500">
            {i + 1}.
          </span>
          <input
            value={n}
            onChange={(e) => {
              const copy = [...names];
              copy[i] = e.target.value;
              onChange(copy);
            }}
            placeholder={`Player ${i + 2}`}
            maxLength={40}
            className="h-10 flex-1 rounded-lg border border-zinc-200 bg-cream px-3 outline-none focus:border-fairway dark:border-zinc-700 dark:bg-zinc-950"
          />
          {names.length > 1 ? (
            <button
              type="button"
              onClick={() => onChange(names.filter((_, j) => j !== i))}
              className="text-zinc-400 transition hover:text-flag"
              aria-label="Remove player"
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
      {names.length < 9 ? (
        <button
          type="button"
          onClick={() => onChange([...names, ''])}
          className="text-xs font-semibold text-fairway hover:text-fairway-deep"
        >
          + Add another player
        </button>
      ) : null}
    </div>
  );
}
