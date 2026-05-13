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
};

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
};

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('picks_participant_golfer_unique').on(t.participantId, t.golferId),
    index('picks_participant_idx').on(t.participantId),
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
