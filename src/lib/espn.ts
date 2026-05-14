/**
 * ESPN public golf API client.
 *
 * Two endpoints we rely on:
 *
 * 1. Leaderboard:
 *    https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga&event=<eventId>
 *    -> field of competitors, current position, status (in/post), basic round summary.
 *
 * 2. Competitor summary (per golfer, hole-by-hole):
 *    https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard/<eventId>/competitorsummary/<athleteId>
 *    -> rounds[].linescores[] with each hole's strokes, par, and scoreType
 *       (PAR | BIRDIE | EAGLE | ALBATROSS | BOGEY | DOUBLE_BOGEY | TRIPLE_BOGEY | ...).
 *
 * No API key required. No documented rate limit, but we keep call volume
 * down by only pulling per-golfer summaries for golfers that someone in
 * the pool actually picked.
 */

import type { ScoringEventKind } from '@/db/schema';

const LEADERBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard';
const SCHEDULE_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';
const COMPETITOR_SUMMARY_URL =
  'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard';

// ---------- types (only the fields we use) ----------

export type EspnLeaderboard = {
  events: Array<{
    id: string;
    name: string;
    status: { type: { state: 'pre' | 'in' | 'post'; description: string } };
    competitions: Array<{
      status: { type: { state: 'pre' | 'in' | 'post' } };
      competitors: EspnCompetitor[];
    }>;
  }>;
};

export type EspnCompetitor = {
  id: string;
  status?: {
    position?: { id?: string; displayName?: string; isTie?: boolean };
    type?: { name?: string; description?: string };
  };
  score?: { value?: number; displayValue?: string };
  /**
   * Per-round summary. The `displayValue` per round (e.g. "-4", "-1") is
   * what ESPN updates *progressively as a round is played* — strictly
   * more current than the cumulative `score.displayValue` above, which
   * can lag by several minutes during a live round. Empty / missing
   * entries indicate a round that hasn't been played yet.
   */
  linescores?: Array<{
    value?: number;
    displayValue?: string;
    period?: number;
  }>;
  athlete: {
    id: string;
    displayName: string;
    flag?: { alt?: string };
  };
};

export type EspnCompetitorSummary = {
  competitor: { id: string; displayName: string };
  rounds: Array<{
    period: number; // round number (1-4)
    value?: number;
    displayValue?: string;
    linescores: Array<{
      value: number; // strokes
      period: number; // hole number (1-18)
      par: number;
      scoreType?: { name?: string };
    }>;
  }>;
};

// ---------- fetching ----------

export async function fetchLeaderboard(eventId: string): Promise<EspnLeaderboard> {
  const url = `${LEADERBOARD_URL}?league=pga&event=${encodeURIComponent(eventId)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`ESPN leaderboard ${res.status} for event ${eventId}`);
  }
  return (await res.json()) as EspnLeaderboard;
}

export async function fetchCompetitorSummary(
  eventId: string,
  athleteId: string,
): Promise<EspnCompetitorSummary> {
  const url = `${COMPETITOR_SUMMARY_URL}/${encodeURIComponent(eventId)}/competitorsummary/${encodeURIComponent(athleteId)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`ESPN competitorsummary ${res.status} for ${eventId}/${athleteId}`);
  }
  return (await res.json()) as EspnCompetitorSummary;
}

// ---------- season schedule ----------

export type ScheduledTournament = {
  espnEventId: string;
  name: string;
  shortName: string;
  startDate: string; // ISO
  state: TournamentState;
  isMajor: boolean;
  /** Current round number (1..4) for in-progress events. Null otherwise. */
  currentRound: number | null;
  /** ESPN's text status, e.g. "Round 1 - In Progress" or "Final". */
  statusDetail: string | null;
};

const MAJOR_NAMES = [
  'masters tournament',
  'pga championship',
  'u.s. open',
  'us open',
  'the open championship',
  'open championship',
];

function isMajor(name: string): boolean {
  const lower = name.toLowerCase();
  return MAJOR_NAMES.some((m) => lower === m || lower.startsWith(m));
}

/**
 * Fetch the full PGA Tour schedule for a given calendar year and return a
 * normalized, lightweight summary suitable for the create-game picker.
 *
 * ESPN returns events for the year sorted roughly by date, including
 * tournaments that have already finished. We pass the raw list through;
 * callers filter to upcoming/live as needed.
 *
 * Cached for an hour — the schedule barely changes, and we don't want to
 * hammer ESPN every time someone opens the create form.
 */
export async function fetchSeasonSchedule(year: number): Promise<ScheduledTournament[]> {
  const url = `${SCHEDULE_URL}?dates=${year}`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new Error(`ESPN scoreboard ${res.status} for year ${year}`);
  }
  const data = (await res.json()) as {
    events?: Array<{
      id: string;
      name: string;
      shortName?: string;
      date: string;
      status?: { type?: { state?: TournamentState } };
      competitions?: Array<{
        status?: {
          period?: number;
          type?: { detail?: string; shortDetail?: string };
        };
      }>;
    }>;
  };
  const events = data.events ?? [];
  return events.map((e) => {
    const compStatus = e.competitions?.[0]?.status;
    const state = (e.status?.type?.state ?? 'pre') as TournamentState;
    return {
      espnEventId: e.id,
      name: e.name,
      shortName: e.shortName ?? e.name,
      startDate: e.date,
      state,
      isMajor: isMajor(e.name),
      currentRound:
        state === 'in' && typeof compStatus?.period === 'number'
          ? compStatus.period
          : null,
      statusDetail:
        compStatus?.type?.detail ?? compStatus?.type?.shortDetail ?? null,
    };
  });
}

// ---------- parsing ----------

export type FieldRow = {
  espnAthleteId: string;
  name: string;
  country: string | null;
  position: string | null;
  scoreToPar: number | null;
  missedCut: boolean;
};

export type TournamentState = 'pre' | 'in' | 'post';

export function parseField(lb: EspnLeaderboard): {
  state: TournamentState;
  field: FieldRow[];
} {
  const ev = lb.events?.[0];
  if (!ev) return { state: 'pre', field: [] };
  const state = (ev.status?.type?.state ?? 'pre') as TournamentState;
  const competitors = ev.competitions?.[0]?.competitors ?? [];

  const field: FieldRow[] = competitors.map((c) => {
    const positionLabel = c.status?.position?.displayName ?? null;
    const statusName = c.status?.type?.name ?? '';
    const isCut =
      positionLabel?.toUpperCase() === 'CUT' ||
      statusName.toUpperCase().includes('CUT') ||
      (c.status?.type?.description ?? '').toUpperCase().includes('CUT');

    // ESPN's score.value on the leaderboard is sometimes total strokes, not
    // score-to-par; the displayValue ("E", "-7", "+3") looks like the
    // reliable source but in practice it lags the per-round summary by
    // several minutes during a live round (a golfer can be -3 mid-round and
    // still read "E" from this field).
    //
    // The per-round `linescores[].displayValue` updates progressively as the
    // round is played, so summing those is strictly more current. Fall back
    // to the cumulative aggregate when no per-round entry has a displayValue
    // yet (pre-tournament).
    const scoreToPar =
      sumLinescoreDisplayValues(c.linescores) ??
      parseScoreToPar(c.score?.displayValue);

    return {
      espnAthleteId: c.athlete.id,
      name: c.athlete.displayName,
      country: c.athlete.flag?.alt ?? null,
      position: positionLabel,
      scoreToPar,
      missedCut: isCut,
    };
  });

  return { state, field };
}

function parseScoreToPar(display: string | undefined): number | null {
  if (!display) return null;
  const v = display.trim().toUpperCase();
  if (v === 'E') return 0;
  if (v === '--' || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sum the `displayValue` of every linescore entry that has one. Returns
 * null when none are populated (pre-tournament or pre-round-1). Exported
 * so it can be unit-tested against captured ESPN payloads.
 */
export function sumLinescoreDisplayValues(
  linescores: Array<{ displayValue?: string }> | undefined,
): number | null {
  if (!linescores || linescores.length === 0) return null;
  let total = 0;
  let any = false;
  for (const ls of linescores) {
    const parsed = parseScoreToPar(ls.displayValue);
    if (parsed === null) continue;
    total += parsed;
    any = true;
  }
  return any ? total : null;
}

/**
 * Map an ESPN scoreType.name to our internal ScoringEventKind.
 * Returns null for "PAR" (no event needed) or unknown values.
 *
 * Special case: a hole played in 1 stroke is always a hole-in-one,
 * regardless of par (an ace on a par-3 reads as EAGLE in ESPN data).
 */
export function classifyHole(strokes: number, par: number, scoreTypeName: string | undefined): ScoringEventKind | null {
  if (strokes === 1) return 'hole_in_one';
  const name = (scoreTypeName ?? '').toUpperCase();
  switch (name) {
    case 'PAR':
      return null;
    case 'BIRDIE':
      return 'birdie';
    case 'EAGLE':
      return 'eagle';
    case 'ALBATROSS':
    case 'DOUBLE_EAGLE':
      return 'albatross';
    case 'BOGEY':
      return 'bogey';
    case 'DOUBLE_BOGEY':
      return 'double_bogey';
    case 'TRIPLE_BOGEY':
    case 'QUADRUPLE_BOGEY':
    case 'OTHER':
      return 'triple_plus';
    default: {
      // Fallback: classify by stroke difference vs par.
      const diff = strokes - par;
      if (diff <= -3) return 'albatross';
      if (diff === -2) return 'eagle';
      if (diff === -1) return 'birdie';
      if (diff === 0) return null;
      if (diff === 1) return 'bogey';
      if (diff === 2) return 'double_bogey';
      return 'triple_plus';
    }
  }
}

export type ParsedHoleEvent = {
  round: number;
  hole: number;
  kind: ScoringEventKind;
};

export function parseHoleEvents(summary: EspnCompetitorSummary): ParsedHoleEvent[] {
  const out: ParsedHoleEvent[] = [];
  for (const round of summary.rounds ?? []) {
    if (!round.linescores || round.linescores.length === 0) continue;
    for (const ls of round.linescores) {
      if (typeof ls.value !== 'number' || ls.value <= 0) continue;
      const kind = classifyHole(ls.value, ls.par, ls.scoreType?.name);
      if (!kind) continue;
      out.push({ round: round.period, hole: ls.period, kind });
    }
  }
  return out;
}
