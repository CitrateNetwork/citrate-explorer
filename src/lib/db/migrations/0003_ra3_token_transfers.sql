ALTER TABLE "token_transfers" ADD COLUMN "block_hash" text;--> statement-breakpoint
ALTER TABLE "token_transfers" ADD COLUMN "block_height" bigint;--> statement-breakpoint
ALTER TABLE "token_transfers" ADD COLUMN "timestamp" bigint;--> statement-breakpoint
ALTER TABLE "token_transfers" ADD COLUMN "standard" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tt_tx_log_id_uq" ON "token_transfers" USING btree ("tx_hash","log_index","token_id");--> statement-breakpoint
CREATE INDEX "tt_block_idx" ON "token_transfers" USING btree ("block_height");--> statement-breakpoint
CREATE INDEX "tt_timestamp_idx" ON "token_transfers" USING btree ("timestamp");