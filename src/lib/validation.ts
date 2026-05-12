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
});

export const createGameSchema = z.object({
  name: z.string().min(1).max(80),
  espnEventId: z.string().min(1).max(40),
  tournamentName: z.string().min(1).max(120),
  // Optional — falls back to the Clerk profile name on the server.
  createdByName: z.string().max(40).default(''),
  scoringRules: scoringRulesSchema.default(DEFAULT_SCORING_RULES),
});

export const joinGameSchema = z.object({
  code: z.string().min(4).max(10),
  displayName: z.string().min(1).max(40),
});

export const submitPicksSchema = z.object({
  golferIds: z.array(z.number().int().positive()),
});
