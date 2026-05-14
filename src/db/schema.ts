import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Default scoring rules. Every game gets a copy of this at creation time
 * which can then be edited per-game. Changing these defaults later does
 * NOT affect existing games — point values are denormalized at the time
 * the scoring_event row is inserted.
 */
export type ScoringRules = {
  hole_in_one: number;
  albatross: number;
  eagle: number;
  birdie: number;
  par: number;
  bogey: number;
  double_bogey: number;
  triple_plus: number;
  finish_1: number;
  finish_2: number;
  finish_3: number;
  /** how many golfers each participant must pick. */
  picks_per_user: number;
  /** how to handle ties on the podium: 'split_floor' | 'full' */
  tie_handling: 'split_floor' | 'full';
  /**
   * Cost (negative points) charged when a participant SUBSTITUTES IN a
   * golfer who is currently in the top 5 on the leaderboard. Index 0 is
   * the cost for the current leader, index 4 is the cost for #5. Defaults
   * to a mild [-3, -2, -1, 0, 0]. Original picks (drafted before round 1)
   * are NEVER charged this cost — only swaps made during the day-1/day-2
   * substitution windows. Stored on the game's scoring_rules JSON so
   * older pools created before this field shipped fall back to defaults
   * at read time via `topPickCosts(rules)`.
   */
  top_pick_costs?: number[];
};

export const DEFAULT_TOP_PICK_COSTS: number[] = [-3, -2, -1, 0, 0];

export const DEFAULT_SCORING_RULES: ScoringRules = {
  hole_in_one: 7,
  albatross: 5,
  eagle: 2,
  birdie: 1,
  par: 0,
  bogey: -1,
  double_bogey: -2,
  triple_plus: -5,
  finish_1: 20,
  finish_2: 10,
  finish_3: 5,
  picks_per_user: 3,
  tie_handling: 'split_floor',
  top_pick_costs: DEFAULT_TOP_PICK_COSTS,
};

/**
 * Resolve top-pick costs from a (possibly old) scoring rules object,
 * returning the default `[-3, -2, -1, 0, 0]` if the field is missing or
 * malformed. Always returns exactly 5 entries.
 */
export function topPickCosts(rules: ScoringRules): number[] {
  const arr = rules.top_pick_costs;
  if (!Array.isArray(arr) || arr.length !== 5) return DEFAULT_TOP_PICK_COSTS;
  if (arr.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return DEFAULT_TOP_PICK_COSTS;
  }
  return arr;
}

/**
 * How players are added to a pool:
 *   - `open`   — anyone with the code can sign up and join (default)
 *   - `manual` — the creator enters the player names upfront; no one
 *                else can join with the code. Manual participants have
 *                `user_id = NULL` and are picked-for by the creator.
 */
export type RosterMode = 'open' | 'manual';

/**
 * How picks are made:
 *   - `free`  — each participant picks K golfers independently;
 *               duplicate picks across participants are allowed (default).
 *   - `snake` — turn-based with a randomized order. Each round reverses:
 *               1→2→…→N, N→…→2→1, 1→…→N, …
 *               No two participants can pick the same golfer.
 */
export type DraftMode = 'free' | 'snake';

export const games = pgTable(
  'games',
  {
    id: serial('id').primaryKey(),
    /** 6-char join code, e.g. "K7P2QX". */
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** ESPN tournament event id, e.g. "401703505" for the 2026 Masters. */
    espnEventId: text('espn_event_id').notNull(),
    tournamentName: text('tournament_name').notNull(),
    /** Per-game scoring rules. Snapshot at creation time. */
    scoringRules: jsonb('scoring_rules').$type<ScoringRules>().notNull(),
    /** What the group is playing for — free-text, e.g. "a beer, hot dogs,
     *  hot soup". Nullable since older pools predate this field. */
    stakes: text('stakes'),
    /** Tournament status as of the last cron tick: pre, in, post. */
    status: text('status').notNull().default('pre'),
    createdByName: text('created_by_name').notNull(),
    /** Clerk user id of the creator. Nullable for legacy rows. */
    createdByUserId: text('created_by_user_id'),
    /** open | manual — see {@link RosterMode}. */
    rosterMode: text('roster_mode').$type<RosterMode>().notNull().default('open'),
    /** free | snake — see {@link DraftMode}. */
    draftMode: text('draft_mode').$type<DraftMode>().notNull().default('free'),
    /**
     * Required when `draft_mode = 'snake'`. The number of players the pool
     * waits for before randomizing the snake order and starting the draft.
     * Null for free-mode pools (no cap).
     */
    maxPlayers: integer('max_players'),
    /**
     * Set once the snake draft has been seeded. While null, the pool is
     * still gathering players (Open+Snake) or hasn't started the draft yet.
     * Used as a cheap "is the draft live?" flag for the UI.
     */
    draftStartedAt: timestamp('draft_started_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('games_code_unique').on(t.code)],
);

export const participants = pgTable(
  'participants',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    /**
     * Clerk user id (e.g. `user_2abc...`). Nullable for legacy cookie-based
     * participants created before auth was introduced. Every new
     * participant created via the Clerk auth flow gets one.
     */
    userId: text('user_id'),
    displayName: text('display_name').notNull(),
    /**
     * Snake-draft turn order (1..N). Null in free-mode pools and in
     * snake-mode pools that haven't started the draft yet (i.e., still
     * waiting for the roster to fill). Once set, the snake walk is:
     *   round 1: order [1, 2, ..., N]
     *   round 2: order [N, ..., 2, 1]
     *   round 3: order [1, 2, ..., N]
     *   ...
     */
    pickOrder: integer('pick_order'),
    /** True once the user has locked in their picks. */
    picksLocked: integer('picks_locked').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('participants_game_name_unique').on(t.gameId, t.displayName),
    // (game_id, user_id) is unique for non-null user_ids — Postgres treats
    // NULLs as distinct so legacy rows with null user_id don't collide.
    uniqueIndex('participants_game_user_unique').on(t.gameId, t.userId),
    index('participants_game_idx').on(t.gameId),
    index('participants_user_idx').on(t.userId),
  ],
);

export const golfers = pgTable(
  'golfers',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    espnAthleteId: text('espn_athlete_id').notNull(),
    name: text('name').notNull(),
    country: text('country'),
    /** Current tournament position as of last sync, e.g. "T4", "1", "CUT". */
    position: text('position'),
    /** Score to par as integer (e.g. -7). Null before tee-off. */
    scoreToPar: integer('score_to_par'),
    /** True once ESPN reports this golfer as cut. */
    missedCut: integer('missed_cut').notNull().default(0),
  },
  (t) => [
    uniqueIndex('golfers_game_athlete_unique').on(t.gameId, t.espnAthleteId),
    index('golfers_game_idx').on(t.gameId),
  ],
);

export const picks = pgTable(
  'picks',
  {
    id: serial('id').primaryKey(),
    participantId: integer('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    golferId: integer('golfer_id')
      .notNull()
      .references(() => golfers.id, { onDelete: 'cascade' }),
    /**
     * Round inclusive bounds for when this pick is active on a participant's
     * roster. New picks default to (1, 99) — active for the whole tournament.
     * When a participant substitutes a pick out after round R, the dropped
     * pick's `endRound` becomes R (it earned points through round R) and the
     * new pick is inserted with `startRound = R + 1`. Round-0 events (finish
     * bonuses, missed_cut markers) only count for picks with `endRound = 99`,
     * i.e. picks the participant is still holding at the end.
     */
    startRound: integer('start_round').notNull().default(1),
    endRound: integer('end_round').notNull().default(99),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('picks_participant_golfer_unique').on(t.participantId, t.golferId),
    index('picks_participant_idx').on(t.participantId),
  ],
);

/**
 * The "swap window" a substitution was used in. Each participant gets at
 * most one substitution per window.
 */
export type SubstitutionWindow = 'day_1' | 'day_2';

export const substitutions = pgTable(
  'substitutions',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    participantId: integer('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    /** 'day_1' or 'day_2'. Each participant can use each window at most once. */
    window: text('window').$type<SubstitutionWindow>().notNull(),
    /** The pick row that was dropped. Its `endRound` was set to the prior round. */
    droppedPickId: integer('dropped_pick_id')
      .notNull()
      .references(() => picks.id, { onDelete: 'cascade' }),
    /** The fresh pick row for the new golfer (startRound = current_round). */
    newPickId: integer('new_pick_id')
      .notNull()
      .references(() => picks.id, { onDelete: 'cascade' }),
    /**
     * Top-pick cost charged for this substitution. 0 if the new pick was
     * outside the top 5 at swap time. Subtracted from the participant's
     * total in `participantTotals`.
     */
    costPoints: integer('cost_points').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('substitutions_participant_window_unique').on(t.participantId, t.window),
    index('substitutions_game_idx').on(t.gameId),
  ],
);

export type ScoringEventKind =
  | 'birdie'
  | 'eagle'
  | 'albatross'
  | 'hole_in_one'
  | 'bogey'
  | 'double_bogey'
  | 'triple_plus'
  | 'finish_1'
  | 'finish_2'
  | 'finish_3'
  | 'missed_cut';

/**
 * Append-only event log of every points-relevant thing that happened to
 * any golfer in any game. Idempotency key is (game_id, golfer_id, kind, round, hole).
 * Finish events use round=0, hole=0 so they have a stable key.
 * missed_cut events use round=0, hole=0 and points=0.
 */
export const scoringEvents = pgTable(
  'scoring_events',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    golferId: integer('golfer_id')
      .notNull()
      .references(() => golfers.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ScoringEventKind>().notNull(),
    round: integer('round').notNull(),
    hole: integer('hole').notNull(),
    /** Denormalized at insert time from the game's scoring_rules. */
    points: integer('points').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('scoring_events_unique').on(t.gameId, t.golferId, t.kind, t.round, t.hole),
    index('scoring_events_game_idx').on(t.gameId),
    index('scoring_events_golfer_idx').on(t.golferId),
  ],
);
