import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { golfers as golfersTable, scoringEvents } from '@/db/schema';
import { getGameByCode } from '@/lib/games';
import {
  fetchCompetitorSummary,
  classifyHole,
  type EspnCompetitorSummary,
} from '@/lib/espn';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';

type Hole = {
  hole: number;
  par: number | null;
  strokes: number | null;
  kind: ReturnType<typeof classifyHole>;
};

type Round = {
  period: number;
  total: number | null;
  totalDisplay: string | null;
  holes: Hole[];
};

export default async function GolferScorecardPage(
  props: PageProps<'/games/[code]/golfer/[golferId]'>,
) {
  const { code, golferId } = await props.params;
  const game = await getGameByCode(code);
  if (!game) notFound();

  const id = Number(golferId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const [golfer] = await db
    .select()
    .from(golfersTable)
    .where(and(eq(golfersTable.id, id), eq(golfersTable.gameId, game.id)))
    .limit(1);
  if (!golfer) notFound();

  // Pull saved scoring events from the DB for the points total. These
  // only exist for golfers someone in the pool picked, or for podium /
  // missed-cut markers. The hole-by-hole strokes always come from ESPN
  // at request time (below) so the scorecard renders for any golfer.
  const events = await db
    .select({ points: scoringEvents.points })
    .from(scoringEvents)
    .where(eq(scoringEvents.golferId, id));
  const totalPoints = events.reduce((sum, e) => sum + e.points, 0);

  // Fetch fresh per-hole data from ESPN. Catch errors so a transient
  // ESPN outage doesn't take down the page; we'll show whatever we have.
  const summary = await fetchCompetitorSummary(
    game.espnEventId,
    golfer.espnAthleteId,
  ).catch((err) => {
    logError(err, {
      subsystem: 'espn',
      operation: 'fetch_competitor_summary',
      extra: {
        gameId: game.id,
        golferId: id,
        espnAthleteId: golfer.espnAthleteId,
      },
    });
    return null;
  });

  const rounds = summary ? parseRounds(summary) : [];

  return (
    <main className="min-h-screen bg-cream dark:bg-zinc-950">
      <Header
        game={game}
        golfer={{
          name: golfer.name,
          country: golfer.country,
          position: golfer.position,
          scoreToPar: golfer.scoreToPar,
          missedCut: golfer.missedCut === 1,
        }}
        totalPoints={totalPoints}
      />

      <div className="mx-auto max-w-5xl px-6 py-8">
        {rounds.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {rounds.map((r) => (
              <RoundScorecard key={r.period} round={r} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function parseRounds(summary: EspnCompetitorSummary): Round[] {
  const rounds: Round[] = [];
  for (const r of summary.rounds ?? []) {
    const holes: Hole[] = [];
    // Build 1..18 even if linescores is sparse.
    const byHole = new Map(r.linescores?.map((ls) => [ls.period, ls]) ?? []);
    for (let h = 1; h <= 18; h++) {
      const ls = byHole.get(h);
      if (!ls) {
        holes.push({ hole: h, par: null, strokes: null, kind: null });
        continue;
      }
      const strokes = typeof ls.value === 'number' && ls.value > 0 ? ls.value : null;
      const kind =
        strokes !== null ? classifyHole(strokes, ls.par, ls.scoreType?.name) : null;
      holes.push({ hole: h, par: ls.par ?? null, strokes, kind });
    }
    rounds.push({
      period: r.period,
      total: typeof r.value === 'number' ? r.value : null,
      totalDisplay: r.displayValue ?? null,
      holes,
    });
  }
  // Sort by round period ascending.
  rounds.sort((a, b) => a.period - b.period);
  return rounds;
}

function Header({
  game,
  golfer,
  totalPoints,
}: {
  game: { code: string; tournamentName: string };
  golfer: {
    name: string;
    country: string | null;
    position: string | null;
    scoreToPar: number | null;
    missedCut: boolean;
  };
  totalPoints: number;
}) {
  return (
    <header className="scorecard-stripe text-white">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <Link
          href={`/games/${game.code}`}
          className="mb-3 inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-fairway-light/90 hover:text-white"
        >
          ← {game.tournamentName}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-black tracking-tight sm:text-4xl">
              {golfer.name}
              {golfer.missedCut ? <span className="ml-2">🍺</span> : null}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-sm text-fairway-light/90">
              {golfer.country ? <span>{golfer.country}</span> : null}
              {golfer.position ? (
                <span>
                  Pos{' '}
                  <span className="font-semibold text-white">
                    {golfer.position}
                  </span>
                </span>
              ) : null}
              <span>
                To par <ScoreToParInline value={golfer.scoreToPar} />
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono text-3xl font-black tabular-nums">
              {totalPoints}
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fairway-light/90">
              pool points
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

function ScoreToParInline({ value }: { value: number | null }) {
  if (value === null) return <span className="text-fairway-light/70">—</span>;
  if (value === 0) return <span className="font-semibold text-white">E</span>;
  if (value < 0)
    return <span className="font-semibold text-podium">{value}</span>;
  return <span className="font-semibold text-white">+{value}</span>;
}

function RoundScorecard({ round }: { round: Round }) {
  const front = round.holes.slice(0, 9);
  const back = round.holes.slice(9);
  const frontStrokes = sumStrokes(front);
  const backStrokes = sumStrokes(back);
  const frontPar = sumPar(front);
  const backPar = sumPar(back);
  const hasAny = round.holes.some((h) => h.strokes !== null);

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="scorecard-stripe flex items-center justify-between px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] text-white">
        <span>Round {round.period}</span>
        <span className="font-mono">
          {round.totalDisplay ??
            (typeof round.total === 'number' ? String(round.total) : '—')}
        </span>
      </div>
      {!hasAny ? (
        <p className="px-4 py-6 text-center text-sm text-zinc-500">
          Round hasn&apos;t been played yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-zinc-50 text-[10px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-950/40">
                <Th>Hole</Th>
                {front.map((h) => (
                  <Th key={`f-${h.hole}`}>{h.hole}</Th>
                ))}
                <Th total>OUT</Th>
                {back.map((h) => (
                  <Th key={`b-${h.hole}`}>{h.hole}</Th>
                ))}
                <Th total>IN</Th>
                <Th total>TOT</Th>
              </tr>
              <tr className="border-b border-zinc-100 bg-zinc-50/50 font-mono text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/30">
                <Th>Par</Th>
                {front.map((h) => (
                  <Td key={`fp-${h.hole}`}>{h.par ?? '—'}</Td>
                ))}
                <Td total>{frontPar ?? '—'}</Td>
                {back.map((h) => (
                  <Td key={`bp-${h.hole}`}>{h.par ?? '—'}</Td>
                ))}
                <Td total>{backPar ?? '—'}</Td>
                <Td total>
                  {frontPar !== null && backPar !== null
                    ? frontPar + backPar
                    : '—'}
                </Td>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Th>Score</Th>
                {front.map((h) => (
                  <HoleCell key={`fs-${h.hole}`} hole={h} />
                ))}
                <Td total>{frontStrokes ?? '—'}</Td>
                {back.map((h) => (
                  <HoleCell key={`bs-${h.hole}`} hole={h} />
                ))}
                <Td total>{backStrokes ?? '—'}</Td>
                <Td total>
                  {frontStrokes !== null && backStrokes !== null
                    ? frontStrokes + backStrokes
                    : '—'}
                </Td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function sumStrokes(holes: Hole[]): number | null {
  let s = 0;
  let any = false;
  for (const h of holes) {
    if (h.strokes === null) return null; // partial round → no subtotal
    s += h.strokes;
    any = true;
  }
  return any ? s : null;
}

function sumPar(holes: Hole[]): number | null {
  let s = 0;
  let any = false;
  for (const h of holes) {
    if (h.par === null) continue;
    s += h.par;
    any = true;
  }
  return any ? s : null;
}

function Th({ children, total = false }: { children: React.ReactNode; total?: boolean }) {
  return (
    <th
      className={`px-2 py-1.5 text-center font-semibold ${
        total ? 'bg-zinc-100 dark:bg-zinc-800' : ''
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  total = false,
}: {
  children: React.ReactNode;
  total?: boolean;
}) {
  return (
    <td
      className={`px-2 py-1.5 text-center font-mono ${
        total ? 'bg-zinc-50 font-semibold dark:bg-zinc-950/40' : ''
      }`}
    >
      {children}
    </td>
  );
}

function HoleCell({ hole }: { hole: Hole }) {
  const colorClass = colorForKind(hole.kind);
  const ringClass = ringForKind(hole.kind);
  return (
    <td className="px-1 py-1 text-center">
      <span
        className={`inline-flex h-7 w-7 items-center justify-center font-mono font-semibold tabular-nums ${colorClass} ${ringClass}`}
        title={hole.kind ?? 'par'}
      >
        {hole.strokes ?? '—'}
      </span>
    </td>
  );
}

function colorForKind(kind: Hole['kind']): string {
  switch (kind) {
    case 'hole_in_one':
      return 'bg-podium text-white';
    case 'albatross':
      return 'bg-fairway-deep text-white';
    case 'eagle':
      return 'bg-fairway text-white';
    case 'birdie':
      return 'bg-fairway-light text-fairway-deep dark:bg-fairway/40 dark:text-white';
    case 'bogey':
      return 'bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200';
    case 'double_bogey':
      return 'bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200';
    case 'triple_plus':
      return 'bg-flag text-white';
    case null:
    default:
      return 'text-zinc-700 dark:text-zinc-200';
  }
}

function ringForKind(kind: Hole['kind']): string {
  // Eagle/albatross/hio = double ring; birdie = single circle ring.
  switch (kind) {
    case 'hole_in_one':
    case 'albatross':
    case 'eagle':
      return 'rounded-full ring-2 ring-offset-1 ring-current';
    case 'birdie':
      return 'rounded-full';
    case 'double_bogey':
    case 'triple_plus':
      return 'rounded-sm';
    default:
      return 'rounded';
  }
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/50 p-12 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-fairway-light text-2xl dark:bg-fairway-deep/40">
        ⛳
      </div>
      <p className="font-medium">No round data yet.</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">
        Either the tournament hasn&apos;t started or ESPN hasn&apos;t published
        this golfer&apos;s linescores. Check back after round 1 tee-off.
      </p>
    </div>
  );
}
