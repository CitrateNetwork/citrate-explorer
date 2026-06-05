ALTER TABLE "contract_verifications" ADD COLUMN "contract_name" text;--> statement-breakpoint
ALTER TABLE "contract_verifications" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "contract_verifications" ADD COLUMN "abi" text;--> statement-breakpoint
ALTER TABLE "contract_verifications" ADD COLUMN "message" text;--> statement-breakpoint
ALTER TABLE "contract_verifications" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "contract_verifications_address_idx" ON "contract_verifications" USING btree ("address");