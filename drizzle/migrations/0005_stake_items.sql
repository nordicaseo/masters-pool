-- PR 11: structured stakes. New JSONB column captures
--   { beers, hotDogs, hotSoup, other }
-- which the create form populates as individual quantity inputs. The
-- legacy `stakes` text column stays around so old pools still render.
ALTER TABLE "games" ADD COLUMN "stake_items" jsonb;
