-- PR 13: emergency pick swap proposals + votes. Mirrors the
-- rule-change-proposal tables in shape. Used when a participant picked
-- the wrong golfer by accident and needs the rest of the pool to bless a
-- one-for-one correction without burning their Day-1/Day-2 substitution.

CREATE TABLE "emergency_swap_proposals" (
  "id" serial PRIMARY KEY NOT NULL,
  "game_id" integer NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "proposed_by_user_id" text NOT NULL,
  "participant_id" integer NOT NULL REFERENCES "participants"("id") ON DELETE CASCADE,
  "dropped_pick_id" integer NOT NULL REFERENCES "picks"("id") ON DELETE CASCADE,
  "new_golfer_id" integer NOT NULL REFERENCES "golfers"("id") ON DELETE CASCADE,
  "proposed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "status" text NOT NULL DEFAULT 'pending',
  "resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "emergency_swap_proposals_game_idx" ON "emergency_swap_proposals" USING btree ("game_id");
--> statement-breakpoint

CREATE TABLE "emergency_swap_votes" (
  "id" serial PRIMARY KEY NOT NULL,
  "proposal_id" integer NOT NULL REFERENCES "emergency_swap_proposals"("id") ON DELETE CASCADE,
  "participant_id" integer NOT NULL REFERENCES "participants"("id") ON DELETE CASCADE,
  "vote" text NOT NULL,
  "voted_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "emergency_swap_votes_unique" ON "emergency_swap_votes" USING btree ("proposal_id","participant_id");
--> statement-breakpoint
CREATE INDEX "emergency_swap_votes_proposal_idx" ON "emergency_swap_votes" USING btree ("proposal_id");
