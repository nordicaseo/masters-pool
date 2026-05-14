-- PR 10: games.start_round — earliest tournament round that counts toward
-- scoring in this pool. Existing rows default to 1 (every round counts),
-- preserving prior behavior. Mid-tournament pools can set this higher to
-- skip already-played days.
ALTER TABLE "games" ADD COLUMN "start_round" integer NOT NULL DEFAULT 1;
