-- PR 4: substitutions + top-5 pick cost.
--
-- 1. Add round bounds to picks. Existing rows default to (1, 99) — active
--    for the entire tournament — which preserves prior scoring behavior.
ALTER TABLE "picks" ADD COLUMN "start_round" integer NOT NULL DEFAULT 1;
ALTER TABLE "picks" ADD COLUMN "end_round" integer NOT NULL DEFAULT 99;
--> statement-breakpoint

-- 2. New table tracking each used substitution. (participant_id, window)
--    unique so a participant can only sub once per day-1/day-2 window.
CREATE TABLE "substitutions" (
  "id" serial PRIMARY KEY NOT NULL,
  "game_id" integer NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "participant_id" integer NOT NULL REFERENCES "participants"("id") ON DELETE CASCADE,
  "window" text NOT NULL,
  "dropped_pick_id" integer NOT NULL REFERENCES "picks"("id") ON DELETE CASCADE,
  "new_pick_id" integer NOT NULL REFERENCES "picks"("id") ON DELETE CASCADE,
  "cost_points" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "substitutions_participant_window_unique" ON "substitutions" USING btree ("participant_id","window");
--> statement-breakpoint
CREATE INDEX "substitutions_game_idx" ON "substitutions" USING btree ("game_id");
