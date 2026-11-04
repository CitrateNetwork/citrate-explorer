-- Genesis guard (r1006 cutover). Nullable on purpose: an existing index records its genesis on the
-- indexer's next start, and only when its lowest live block is the block the RPC serves at that
-- height (src/lib/indexer/genesisGuard.ts). Never backfill genesis_hash by hand from the RPC.
ALTER TABLE "indexer_state" ADD COLUMN "genesis_hash" text;--> statement-breakpoint
ALTER TABLE "indexer_state" ADD COLUMN "genesis_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "indexer_state" ADD COLUMN "genesis_status" text;--> statement-breakpoint
ALTER TABLE "indexer_state" ADD COLUMN "genesis_code" text;--> statement-breakpoint
ALTER TABLE "indexer_state" ADD COLUMN "genesis_observed" text;--> statement-breakpoint
ALTER TABLE "indexer_state" ADD COLUMN "genesis_detail" text;--> statement-breakpoint
ALTER TABLE "indexer_state" ADD COLUMN "genesis_checked_at" timestamp with time zone;
