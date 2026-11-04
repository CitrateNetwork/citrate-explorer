CREATE TABLE "contract_proxies" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text,
	"chain_id" integer NOT NULL,
	"genesis_hash" text NOT NULL,
	"address" text NOT NULL,
	"implementation" text NOT NULL,
	"proxy_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'verify' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"origin" text NOT NULL,
	"chain_id" integer NOT NULL,
	"genesis_hash" text,
	"address" text NOT NULL,
	"request" text NOT NULL,
	"source_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"worker_id" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result_code" text,
	"result_message" text,
	"match_type" text,
	"verified_contract_id" text
);
--> statement-breakpoint
CREATE TABLE "verification_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "verified_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text,
	"chain_id" integer NOT NULL,
	"genesis_hash" text,
	"address" text NOT NULL,
	"runtime_code_hash" text,
	"runtime_masked_hash" text,
	"runtime_code_length" integer,
	"match_type" text NOT NULL,
	"runtime_match" text NOT NULL,
	"creation_match" text,
	"similar_to" text,
	"source_format" text NOT NULL,
	"contract_name" text,
	"fully_qualified_name" text,
	"compiler_version" text,
	"solc_long_version" text,
	"std_json_input" text,
	"metadata" text,
	"abi" text,
	"storage_layout" text,
	"deployed_source_map" text,
	"creation_source_map" text,
	"immutable_references" text,
	"constructor_args" text,
	"libraries" text,
	"creation_tx_hash" text,
	"deployer" text,
	"source_hash" text,
	"legacy_guid" text,
	"legacy_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "contract_proxies_key_idx" ON "contract_proxies" USING btree ("genesis_hash","address");--> statement-breakpoint
CREATE INDEX "verification_jobs_status_idx" ON "verification_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "verification_jobs_address_idx" ON "verification_jobs" USING btree ("address");--> statement-breakpoint
CREATE INDEX "verified_contracts_key_idx" ON "verified_contracts" USING btree ("genesis_hash","address","runtime_code_hash");--> statement-breakpoint
CREATE INDEX "verified_contracts_address_idx" ON "verified_contracts" USING btree ("address");--> statement-breakpoint
CREATE INDEX "verified_contracts_length_idx" ON "verified_contracts" USING btree ("genesis_hash","runtime_code_length");--> statement-breakpoint
-- Verification v2: verified_contracts and contract_proxies are append-only.
CREATE OR REPLACE FUNCTION "verification_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: rows are never updated or deleted', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "verified_contracts_append_only" BEFORE UPDATE OR DELETE ON "verified_contracts" FOR EACH ROW EXECUTE FUNCTION "verification_append_only"();
--> statement-breakpoint
CREATE TRIGGER "contract_proxies_append_only" BEFORE UPDATE OR DELETE ON "contract_proxies" FOR EACH ROW EXECUTE FUNCTION "verification_append_only"();
--> statement-breakpoint
-- Carry contract_verifications forward. The old table is left in place, untouched.
-- Every old guid stays pollable as a finished job.
INSERT INTO "verification_jobs" ("id", "kind", "status", "origin", "chain_id", "genesis_hash", "address", "request", "source_hash", "created_at", "finished_at", "result_code", "result_message", "match_type", "verified_contract_id")
SELECT
  "guid",
  'verify',
  CASE WHEN "status" = 'pass' THEN 'pass' ELSE 'fail' END,
  'legacy',
  40204,
  NULL,
  lower("address"),
  json_build_object('legacy', true, 'compilerVersion', "compiler_version")::text,
  "source_hash",
  COALESCE("submitted_at", now()),
  COALESCE("verified_at", "submitted_at", now()),
  CASE WHEN "status" = 'pass' THEN 'legacy_pass' ELSE 'legacy_fail' END,
  CASE WHEN "status" IN ('pass', 'fail') THEN "message" ELSE 'submitted before verification v2 and never completed; resubmit' END,
  CASE WHEN "status" = 'pass' THEN "match_type" ELSE NULL END,
  CASE WHEN "status" = 'pass' THEN 'legacy_' || "guid" ELSE NULL END
FROM "contract_verifications"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Passing rows become legacy verified records: no genesis or code hash (the old
-- store did not record them), match type kept, a null match type read as partial.
INSERT INTO "verified_contracts" ("id", "job_id", "chain_id", "genesis_hash", "address", "match_type", "runtime_match", "source_format", "contract_name", "fully_qualified_name", "compiler_version", "abi", "source_hash", "legacy_guid", "legacy_source", "created_at")
SELECT
  'legacy_' || "guid",
  "guid",
  40204,
  NULL,
  lower("address"),
  CASE WHEN "match_type" = 'full' THEN 'full' ELSE 'partial' END,
  CASE WHEN "match_type" = 'full' THEN 'full' ELSE 'partial' END,
  'legacy',
  regexp_replace(COALESCE("contract_name", ''), '^.*:', ''),
  "contract_name",
  "compiler_version",
  "abi",
  "source_hash",
  "guid",
  "source",
  COALESCE("verified_at", "submitted_at", now())
FROM "contract_verifications"
WHERE "status" = 'pass'
ON CONFLICT ("id") DO NOTHING;
