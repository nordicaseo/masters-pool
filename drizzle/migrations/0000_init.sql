CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"espn_event_id" text NOT NULL,
	"tournament_name" text NOT NULL,
	"scoring_rules" jsonb NOT NULL,
	"status" text DEFAULT 'pre' NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "golfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"espn_athlete_id" text NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"position" text,
	"score_to_par" integer,
	"missed_cut" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"picks_locked" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "picks" (
	"id" serial PRIMARY KEY NOT NULL,
	"participant_id" integer NOT NULL,
	"golfer_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"golfer_id" integer NOT NULL,
	"kind" text NOT NULL,
	"round" integer NOT NULL,
	"hole" integer NOT NULL,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "golfers" ADD CONSTRAINT "golfers_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_golfer_id_golfers_id_fk" FOREIGN KEY ("golfer_id") REFERENCES "public"."golfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_events" ADD CONSTRAINT "scoring_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_events" ADD CONSTRAINT "scoring_events_golfer_id_golfers_id_fk" FOREIGN KEY ("golfer_id") REFERENCES "public"."golfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "games_code_unique" ON "games" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "golfers_game_athlete_unique" ON "golfers" USING btree ("game_id","espn_athlete_id");--> statement-breakpoint
CREATE INDEX "golfers_game_idx" ON "golfers" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_game_name_unique" ON "participants" USING btree ("game_id","display_name");--> statement-breakpoint
CREATE INDEX "participants_game_idx" ON "participants" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "picks_participant_golfer_unique" ON "picks" USING btree ("participant_id","golfer_id");--> statement-breakpoint
CREATE INDEX "picks_participant_idx" ON "picks" USING btree ("participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_events_unique" ON "scoring_events" USING btree ("game_id","golfer_id","kind","round","hole");--> statement-breakpoint
CREATE INDEX "scoring_events_game_idx" ON "scoring_events" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "scoring_events_golfer_idx" ON "scoring_events" USING btree ("golfer_id");