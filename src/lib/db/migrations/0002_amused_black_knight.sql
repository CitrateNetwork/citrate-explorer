ALTER TABLE "api_keys" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "provider_keys" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "iv" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "blind_index" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "encrypted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- SR-0 backfill: existing rows were keyed by the (wallet) user_address; adopt it as
-- the subject so no data is orphaned. New writes set subject = the OIDC `sub`. The
-- backfill runs BEFORE the unique index on settings.subject so that index is built
-- over already-unique values (user_address is the settings PK).
UPDATE "api_keys" SET "subject" = "user_address" WHERE "subject" IS NULL;--> statement-breakpoint
UPDATE "audit_log" SET "subject" = "user_address" WHERE "subject" IS NULL;--> statement-breakpoint
UPDATE "provider_keys" SET "subject" = "user_address" WHERE "subject" IS NULL;--> statement-breakpoint
UPDATE "settings" SET "subject" = "user_address" WHERE "subject" IS NULL;--> statement-breakpoint
UPDATE "threads" SET "subject" = "user_address" WHERE "subject" IS NULL;--> statement-breakpoint
UPDATE "watchlist" SET "subject" = "user_address" WHERE "subject" IS NULL;--> statement-breakpoint
CREATE INDEX "api_keys_subject_idx" ON "api_keys" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "audit_subject_idx" ON "audit_log" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "provider_keys_subject_idx" ON "provider_keys" USING btree ("subject");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_subject_idx" ON "settings" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "threads_subject_updated_idx" ON "threads" USING btree ("subject","updated_at");--> statement-breakpoint
CREATE INDEX "watchlist_subject_idx" ON "watchlist" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "watchlist_blind_index_idx" ON "watchlist" USING btree ("blind_index");