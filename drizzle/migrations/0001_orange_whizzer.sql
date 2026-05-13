-- Stakes column. The rest of the diff drizzle-kit generated was for
-- columns added via `db:push` against prod long ago — keeping them out
-- so this file is a clean record of what changed in this PR.
ALTER TABLE "games" ADD COLUMN "stakes" text;
