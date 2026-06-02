/** Shared indexer types. The DB row shapes live in src/lib/db/schema.ts. */

/** Returned by repository reads when DATABASE_URL is unset (Rule 11: honest). */
export interface NotProvisioned {
  provisioned: false;
  note: string;
}

export type Provisioned<T> = { provisioned: true } & T;

export const NOT_PROVISIONED: NotProvisioned = {
  provisioned: false,
  note:
    "The chain index is not provisioned (DATABASE_URL unset). Live single-entity " +
    "reads still work via RPC; aggregate/history queries need the indexer (S-1).",
};
