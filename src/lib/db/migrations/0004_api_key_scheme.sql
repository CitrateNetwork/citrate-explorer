ALTER TABLE "api_keys" ADD COLUMN "key_scheme" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
-- Key-storage upgrade: keys minted by earlier releases (key_scheme 'legacy', including any minted
-- by old code after this migration ran) never match the current lookup and do not count toward
-- the per-owner key cap, whichever order code and migration deploy in. Mark them revoked so
-- Settings shows them as retired; owners re-mint.
UPDATE "api_keys" SET "revoked" = true WHERE "key_scheme" = 'legacy' AND "revoked" = false;
