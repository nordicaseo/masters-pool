-- PR 8: creator-proposed rule changes with unanimous-approval gating.
-- Pending proposals open after the game starts; every participant with a
-- Clerk user must approve before the new rules take effect (and existing
-- scoring_events get recomputed retroactively).

CREATE TABLE "rule_change_proposals" (
  "id" serial PRIMARY KEY NOT NULL,
  "game_id" integer NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "proposed_by_user_id" text NOT NULL,
  "proposed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "before_rules" jsonb NOT NULL,
  "after_rules" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "rule_change_proposals_game_idx" ON "rule_change_proposals" USING btree ("game_id");
--> statement-breakpoint

CREATE TABLE "rule_change_votes" (
  "id" serial PRIMARY KEY NOT NULL,
  "proposal_id" integer NOT NULL REFERENCES "rule_change_proposals"("id") ON DELETE CASCADE,
  "participant_id" integer NOT NULL REFERENCES "participants"("id") ON DELETE CASCADE,
  "vote" text NOT NULL,
  "voted_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rule_change_votes_unique" ON "rule_change_votes" USING btree ("proposal_id","participant_id");
--> statement-breakpoint
CREATE INDEX "rule_change_votes_proposal_idx" ON "rule_change_votes" USING btree ("proposal_id");
