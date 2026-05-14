import { topPickCosts, type ScoringRules, type DraftMode, type RosterMode } from '@/db/schema';

/**
 * "House rules" card — quick visual summary of the game's scoring &
 * format so players know what's at stake without digging through
 * settings. Emoji-chips keep it readable at a glance; chips with a
 * point value of 0 are omitted so the card focuses on what actually
 * earns or costs points.
 */
export function HouseRules({
  scoringRules,
  draftMode,
  rosterMode,
}: {
  scoringRules: ScoringRules;
  draftMode: DraftMode;
  rosterMode: RosterMode;
}) {
  const r = scoringRules;
  const costs = topPickCosts(r);
  const costsActive = costs.some((c) => c !== 0);

  // Format row: how many picks, what kind of draft, what kind of roster.
  const formatChips: ChipSpec[] = [
    {
      emoji: '🏌️',
      label: `${r.picks_per_user} pick${r.picks_per_user === 1 ? '' : 's'} each`,
    },
    draftMode === 'snake'
      ? { emoji: '🐍', label: 'Snake draft' }
      : { emoji: '🎲', label: 'Free draft' },
    rosterMode === 'manual'
      ? { emoji: '📋', label: 'Manual roster' }
      : { emoji: '🚪', label: 'Open join' },
  ];

  // Per-hole. Keep the order birdies-good → bogeys-bad for legibility.
  const holeChips: ChipSpec[] = [
    { emoji: '🕳️⛳', label: 'Hole-in-one', value: r.hole_in_one },
    { emoji: '🦅', label: 'Albatross', value: r.albatross },
    { emoji: '🦅', label: 'Eagle', value: r.eagle },
    { emoji: '🐦', label: 'Birdie', value: r.birdie },
    { emoji: '😬', label: 'Bogey', value: r.bogey },
    { emoji: '😖', label: 'Double', value: r.double_bogey },
    { emoji: '💀', label: 'Triple+', value: r.triple_plus },
  ].filter((c) => (c.value ?? 0) !== 0);

  const finishChips: ChipSpec[] = [
    { emoji: '🏆', label: '1st', value: r.finish_1 },
    { emoji: '🥈', label: '2nd', value: r.finish_2 },
    { emoji: '🥉', label: '3rd', value: r.finish_3 },
  ].filter((c) => (c.value ?? 0) !== 0);

  return (
    <section className="mb-8 overflow-hidden rounded-2xl border border-fairway-deep/15 bg-white shadow-sm dark:border-fairway-light/20 dark:bg-zinc-900">
      <div className="scorecard-stripe flex items-center justify-between px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white">
        <span>House rules</span>
        <span className="font-mono">⛳</span>
      </div>
      <div className="space-y-3 p-4">
        <ChipRow label="Format" chips={formatChips} />
        {holeChips.length > 0 ? (
          <ChipRow label="Per hole" chips={holeChips} />
        ) : null}
        {finishChips.length > 0 ? (
          <ChipRow label="Finish bonuses" chips={finishChips} />
        ) : null}
        {costsActive ? (
          <ChipRow
            label="Top-pick sub cost"
            chips={costs.map((c, i) => ({
              emoji: ['🥇', '🥈', '🥉', '#4', '#5'][i] ?? `#${i + 1}`,
              label: `#${i + 1}`,
              value: c,
            }))}
          />
        ) : null}
      </div>
    </section>
  );
}

type ChipSpec = {
  emoji: string;
  label: string;
  /** Optional points value. When present, the chip renders as e.g. "Birdie +1". */
  value?: number;
};

function ChipRow({ label, chips }: { label: string; chips: ChipSpec[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c, i) => (
          <Chip key={i} chip={c} />
        ))}
      </div>
    </div>
  );
}

function Chip({ chip }: { chip: ChipSpec }) {
  const hasValue = typeof chip.value === 'number';
  const positive = hasValue && (chip.value ?? 0) > 0;
  const negative = hasValue && (chip.value ?? 0) < 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
        positive
          ? 'bg-fairway-light text-fairway-deep dark:bg-fairway-deep/40 dark:text-fairway-light'
          : negative
            ? 'bg-flag/10 text-flag'
            : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
      }`}
    >
      <span aria-hidden>{chip.emoji}</span>
      <span className="font-medium">{chip.label}</span>
      {hasValue ? (
        <span className="font-mono font-semibold tabular-nums">
          {(chip.value ?? 0) > 0 ? `+${chip.value}` : chip.value}
        </span>
      ) : null}
    </span>
  );
}
