CREATE TYPE "public"."dag_edge_kind" AS ENUM('selected_parent', 'merge_parent');--> statement-breakpoint
CREATE TABLE "accounts" (
	"address" text PRIMARY KEY NOT NULL,
	"balance" text DEFAULT '0' NOT NULL,
	"nonce" bigint DEFAULT 0 NOT NULL,
	"is_contract" boolean DEFAULT false NOT NULL,
	"tx_count" integer DEFAULT 0 NOT NULL,
	"first_seen" bigint,
	"last_seen" bigint
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"key_hash" text NOT NULL,
	"label" text,
	"quota_per_day" integer DEFAULT 100000 NOT NULL,
	"rate_limit_per_sec" integer DEFAULT 5 NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_used" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text,
	"tool" text NOT NULL,
	"args" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"hash" text PRIMARY KEY NOT NULL,
	"height" bigint NOT NULL,
	"blue_score" bigint NOT NULL,
	"blue_work" text DEFAULT '0' NOT NULL,
	"is_blue" boolean DEFAULT true NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL,
	"superseded" boolean DEFAULT false NOT NULL,
	"timestamp" bigint NOT NULL,
	"selected_parent" text,
	"proposer" text,
	"gas_used" bigint DEFAULT 0 NOT NULL,
	"gas_limit" bigint DEFAULT 0 NOT NULL,
	"base_fee_per_gas" text,
	"tx_count" integer DEFAULT 0 NOT NULL,
	"state_root" text,
	"tx_root" text,
	"receipt_root" text
);
--> statement-breakpoint
CREATE TABLE "contract_verifications" (
	"guid" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"match_type" text,
	"compiler_version" text,
	"source_hash" text,
	"submitted_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"address" text PRIMARY KEY NOT NULL,
	"creator" text,
	"creation_tx" text,
	"bytecode_hash" text,
	"verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"compiler_version" text,
	"proxy_impl" text
);
--> statement-breakpoint
CREATE TABLE "dag_edges" (
	"child_hash" text NOT NULL,
	"parent_hash" text NOT NULL,
	"kind" "dag_edge_kind" NOT NULL,
	CONSTRAINT "dag_edges_child_hash_parent_hash_pk" PRIMARY KEY("child_hash","parent_hash")
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_height" bigint DEFAULT 0 NOT NULL,
	"last_blue_score" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"address" text NOT NULL,
	"topic0" text,
	"topic1" text,
	"topic2" text,
	"topic3" text,
	"data" text,
	"block_height" bigint
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "provider_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"provider" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"tx_hash" text PRIMARY KEY NOT NULL,
	"status" integer,
	"gas_used" bigint,
	"cumulative_gas_used" bigint,
	"contract_address" text,
	"logs_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"user_address" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "thread_memory" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"summary_ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "token_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"tx_hash" text NOT NULL,
	"token" text NOT NULL,
	"from_addr" text NOT NULL,
	"to_addr" text NOT NULL,
	"value" text,
	"token_id" text,
	"log_index" integer
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"address" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text,
	"symbol" text,
	"decimals" integer,
	"total_supply" text
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"hash" text PRIMARY KEY NOT NULL,
	"block_hash" text,
	"block_height" bigint,
	"tx_index" integer,
	"from_addr" text NOT NULL,
	"to_addr" text,
	"value" text DEFAULT '0' NOT NULL,
	"nonce" bigint,
	"gas_limit" bigint,
	"gas_price" text,
	"status" integer,
	"method_id" text,
	"eth_tx_type" integer,
	"created_contract" text,
	"timestamp" bigint
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"target" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_log" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "blocks_height_idx" ON "blocks" USING btree ("height");--> statement-breakpoint
CREATE INDEX "blocks_blue_score_idx" ON "blocks" USING btree ("blue_score");--> statement-breakpoint
CREATE INDEX "blocks_timestamp_idx" ON "blocks" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "dag_edges_child_idx" ON "dag_edges" USING btree ("child_hash");--> statement-breakpoint
CREATE INDEX "dag_edges_parent_idx" ON "dag_edges" USING btree ("parent_hash");--> statement-breakpoint
CREATE INDEX "logs_address_idx" ON "logs" USING btree ("address");--> statement-breakpoint
CREATE INDEX "logs_topic0_idx" ON "logs" USING btree ("topic0");--> statement-breakpoint
CREATE INDEX "logs_tx_idx" ON "logs" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "threads_user_updated_idx" ON "threads" USING btree ("user_address","updated_at");--> statement-breakpoint
CREATE INDEX "tt_token_idx" ON "token_transfers" USING btree ("token");--> statement-breakpoint
CREATE INDEX "tt_from_idx" ON "token_transfers" USING btree ("from_addr");--> statement-breakpoint
CREATE INDEX "tt_to_idx" ON "token_transfers" USING btree ("to_addr");--> statement-breakpoint
CREATE INDEX "tx_from_idx" ON "transactions" USING btree ("from_addr");--> statement-breakpoint
CREATE INDEX "tx_to_idx" ON "transactions" USING btree ("to_addr");--> statement-breakpoint
CREATE INDEX "tx_block_idx" ON "transactions" USING btree ("block_height");--> statement-breakpoint
CREATE INDEX "tx_timestamp_idx" ON "transactions" USING btree ("timestamp");