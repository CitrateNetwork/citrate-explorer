/**
 * Production adapters for the genesis guard (genesisGuard.ts).
 *
 * Data sources (Rule 7):
 *  - {@link rpcGenesisSource}: live Citrate RPC, `eth_getBlockByNumber(<height>, false).hash`.
 *  - {@link dbGenesisStore}: Postgres `indexer_state` (recorded genesis + last check) and
 *    `blocks` (the index's lowest live block, the anchor proving which chain the rows are from).
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PublicClient } from "viem";
import { citrateRequest } from "@/lib/citrate/rpc";
import { harnessClient } from "@/lib/harness/client";
import type { Database } from "@/lib/db/client";
import { blocks, indexerState } from "@/lib/db/schema";
import {
  GenesisNotMigratedError,
  isUndefinedColumn,
  type GenesisRpc,
  type GenesisStatusRecord,
  type GenesisStore,
} from "./genesisGuard";
import type { GenesisRead } from "./health";

export function rpcGenesisSource(client: PublicClient = harnessClient()): GenesisRpc {
  return {
    async blockHashAt(height: number) {
      const raw = await citrateRequest<{ hash?: string } | null>(client, "eth_getBlockByNumber", [
        `0x${height.toString(16)}`,
        false,
      ]);
      return raw?.hash ?? null;
    },
  };
}

export function dbGenesisStore(db: Database): GenesisStore {
  /** Runs a query, turning Postgres undefined_column (no 0005 columns) into GenesisNotMigratedError. */
  const q = async <T>(f: () => Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (err) {
      if (isUndefinedColumn(err)) throw new GenesisNotMigratedError();
      throw err;
    }
  };

  const ensureRow = () =>
    q(() => db.insert(indexerState).values({ id: 1 }).onConflictDoNothing({ target: indexerState.id }));

  const recorded = (): Promise<string | null> =>
    q(async () => {
      const [row] = await db
        .select({ g: indexerState.genesisHash })
        .from(indexerState)
        .where(eq(indexerState.id, 1))
        .limit(1);
      return row?.g ?? null;
    });

  return {
    recorded,

    lastStatus: () =>
      q(async () => {
        const [row] = await db
          .select({ s: indexerState.genesisStatus })
          .from(indexerState)
          .where(eq(indexerState.id, 1))
          .limit(1);
        return row?.s ?? null;
      }),

    anchor: () =>
      q(async () => {
        const [row] = await db
          .select({ height: blocks.height, hash: blocks.hash })
          .from(blocks)
          .where(eq(blocks.superseded, false))
          .orderBy(asc(blocks.height))
          .limit(1);
        return row ?? null;
      }),

    async record(genesis: string) {
      await ensureRow();
      // Write-once: only an empty slot is filled, so a concurrent writer cannot overwrite.
      await q(() =>
        db
          .update(indexerState)
          .set({ genesisHash: genesis, genesisRecordedAt: sql`now()` })
          .where(and(eq(indexerState.id, 1), isNull(indexerState.genesisHash))),
      );
      return recorded();
    },

    async markStatus(s: GenesisStatusRecord) {
      await ensureRow();
      await q(() =>
        db
          .update(indexerState)
          .set({
            genesisStatus: s.status,
            genesisCode: s.code,
            genesisObserved: s.observed,
            genesisDetail: s.detail,
            genesisCheckedAt: sql`now()`,
          })
          .where(eq(indexerState.id, 1)),
      );
    },
  };
}

/**
 * The recorded genesis and last check, for /api/health. null when the index is not provisioned;
 * `{ migrated: false }` when the database predates migration 0005 (merge auto-deploys before
 * `pnpm db:migrate` runs). Other errors throw; the health route reports them separately.
 */
export async function readGenesisState(db: Database | null): Promise<GenesisRead | null> {
  if (!db) return null;
  try {
    const [row] = await db
      .select({
        recorded: indexerState.genesisHash,
        status: indexerState.genesisStatus,
        code: indexerState.genesisCode,
        checkedAt: indexerState.genesisCheckedAt,
      })
      .from(indexerState)
      .where(eq(indexerState.id, 1))
      .limit(1);
    return {
      migrated: true,
      recorded: row?.recorded ?? null,
      status: row?.status ?? null,
      code: row?.code ?? null,
      checkedAt: row?.checkedAt ?? null,
    };
  } catch (err) {
    if (isUndefinedColumn(err)) return { migrated: false };
    throw err;
  }
}
