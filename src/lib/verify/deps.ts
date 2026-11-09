/**
 * What the verification web routes run against (EXP-S2): the index database
 * (null when DATABASE_URL is unset) and the live Citrate RPC. One seam, so route
 * tests can substitute PGlite and recorded chain state.
 *
 * Data sources (Rule 7): DATABASE_URL Postgres (src/lib/db/client.ts) and the
 * Citrate RPC at NEXT_PUBLIC_CITRATE_RPC_URL (./chain.ts).
 */
import { getDb } from "@/lib/db/client";
import type { ChainDb } from "@/lib/indexer/types";
import { liveChainReader, type ChainReader } from "./chain";

export interface VerifyDeps {
  db: ChainDb | null;
  chain: ChainReader;
}

let chain: ChainReader | null = null;

export function verifyDeps(): VerifyDeps {
  chain ??= liveChainReader();
  return { db: getDb() as unknown as ChainDb | null, chain };
}
