import { z } from 'zod';
import { DEFAULT_SCORING_RULES } from '@/db/schema';

export const scoringRulesSchema = z.object({
  hole_in_one: z.number().int(),
  albatross: z.number().int(),
  eagle: z.number().int(),
  birdie: z.number().int(),
  par: z.number().int(),
  bogey: z.number().int(),
  double_bogey: z.number().int(),
  triple_plus: z.number().int(),
  finish_1: z.number().int(),
  finish_2: z.number().int(),
  finish_3: z.number().int(),
  picks_per_user: z.number().int().min(1).max(10),
  tie_handling: z.enum(['split_floor', 'full']),
  /** Cost for substituting in a top-1..top-5 golfer; exactly 5 entries. */
  top_pick_costs: z.array(z.number().int().min(-50).max(0)).length(5).optional(),
});

export const createGameSchema = z
  .object({
    name: z.string().min(1).max(80),
    espnEventId: z.string().min(1).max(40),
    tournamentName: z.string().min(1).max(120),
    // Optional — falls back to the Clerk profile name on the server.
    createdByName: z.string().max(40).default(''),
    scoringRules: scoringRulesSchema.default(DEFAULT_SCORING_RULES),
    rosterMode: z.enum(['open', 'manual']).default('open'),
    draftMode: z.enum(['free', 'snake']).default('free'),
    maxPlayers: z.number().int().min(2).max(10).optional(),
    /** Display names of the manual roster, when rosterMode === 'manual'. */
    manualPlayerNames: z.array(z.string().min(1).max(40)).max(10).optional(),
    /** Free-text stakes — what the group is playing for. */
    stakes: z.string().max(200).optional(),
  })
  .refine(
    (v) =>
      v.draftMode !== 'snake' ||
      (v.rosterMode === 'open' && typeof v.maxPlayers === 'number') ||
      (v.rosterMode === 'manual' &&
        Array.isArray(v.manualPlayerNames) &&
        v.manualPlayerNames.length >= 2),
    {
      message:
        'Snake draft needs a player count (open) or at least 2 manual player names (manual)',
    },
  )
  .refine(
    (v) =>
      v.rosterMode !== 'manual' ||
      (Array.isArray(v.manualPlayerNames) && v.manualPlayerNames.length >= 1),
    { message: 'Manual rosters need at least 1 player name' },
  );

export const joinGameSchema = z.object({
  code: z.string().min(4).max(10),
  displayName: z.string().min(1).max(40),
});

export const submitPicksSchema = z.object({
  golferIds: z.array(z.number().int().positive()),
});

export const substitutionSchema = z.object({
  /** Pick id to drop from your current roster. */
  droppedPickId: z.number().int().positive(),
  /** Golfer id to add. */
  newGolferId: z.number().int().positive(),
  /** Optional — only set when the creator subs on behalf of a manual participant. */
  participantId: z.number().int().positive().optional(),
});
