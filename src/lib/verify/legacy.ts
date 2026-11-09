/**
 * Records copied forward from the v1 store (migration 0006). The old store recorded neither
 * the chain nor the code a match was made against, so such a record is not confirmed for
 * the code at the address now: no API reports it as verified or as a full match, and the
 * contract page shows its source labelled "legacy, not confirmed". Pure, so the browser
 * adapter (src/lib/contract/infoSources.ts) and the server use the same test.
 */
export function isLegacyRecord(row: { sourceFormat: string; legacyGuid: string | null; genesisHash: string | null }): boolean {
  return row.sourceFormat === "legacy" || (row.legacyGuid !== null && row.genesisHash === null);
}
